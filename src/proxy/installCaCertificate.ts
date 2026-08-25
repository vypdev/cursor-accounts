import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CA_COMMON_NAME } from './certificateConstants';

/** System CA file path from the Linux install guide. */
export const LINUX_SYSTEM_CA_PATH =
  '/usr/local/share/ca-certificates/cursor-accounts-mitm.crt';

export interface CertificateInstallResult {
  success: boolean;
  error?: string;
}

export interface CertificateProcessRunner {
  run(
    command: string,
    args: string[],
    timeoutMs?: number
  ): Promise<{ code: number | null; stderr: string }>;
}

export const DEFAULT_CERTIFICATE_PROCESS_TIMEOUT_MS = 120_000;
export const CERTIFICATE_PROCESS_KILL_GRACE_MS = 1_000;

/** Escape a path for use inside a double-quoted shell string on Unix. */
export function escapeShellDoubleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Escape a path for use inside a single-quoted PowerShell string. */
export function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildMacInstallScript(certPath: string): string {
  const quoted = escapeShellDoubleQuoted(certPath);
  const cmd = `security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${quoted}"`;
  const escapedForAppleScript = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `do shell script "${escapedForAppleScript}" with administrator privileges`;
}

export function buildWindowsVerifyCommand(commonName: string = CA_COMMON_NAME): string {
  const escapedCn = commonName.replace(/'/g, "''");
  return `$cert = Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object { $_.Subject -like '*${escapedCn}*' } | Select-Object -First 1; if ($null -eq $cert) { exit 1 } else { exit 0 }`;
}

export function buildWindowsInstallCommand(certPath: string): string {
  const filePath = escapePowerShellSingleQuoted(path.normalize(certPath));
  const importCmd = `Import-Certificate -FilePath '${filePath}' -CertStoreLocation Cert:\\LocalMachine\\Root`;
  const escapedInner = importCmd.replace(/'/g, "''");
  return `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command','${escapedInner}'`;
}

export function buildMacUninstallScript(
  commonName: string = CA_COMMON_NAME
): string {
  const escapedCn = escapeShellDoubleQuoted(commonName);
  const cmd = `security delete-certificate -c "${escapedCn}" /Library/Keychains/System.keychain`;
  const escapedForAppleScript = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `do shell script "${escapedForAppleScript}" with administrator privileges`;
}

export function buildWindowsUninstallCommand(
  commonName: string = CA_COMMON_NAME
): string {
  const escapedCn = commonName.replace(/'/g, "''");
  const deleteCmd = `certutil -delstore Root "${escapedCn}"`;
  const escapedInner = deleteCmd.replace(/'/g, "''");
  return `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command','${escapedInner}'`;
}

/** User-facing message when Linux uninstall must be done manually. */
export const LINUX_UNINSTALL_MANUAL_MESSAGE =
  'On Linux, run: sudo rm /usr/local/share/ca-certificates/cursor-accounts-mitm.crt && sudo update-ca-certificates';

function normalizeInstallError(stderr: string, fallback: string): string {
  const message = stderr.trim() || fallback;
  if (/User canceled|user cancelled|cancelled|canceled/i.test(message)) {
    return 'Installation canceled by user';
  }
  if (/denied|not authorized|permission/i.test(message)) {
    return 'Permission denied';
  }
  return message;
}

export async function runCertificateProcess(
  command: string,
  args: string[],
  timeoutMs = DEFAULT_CERTIFICATE_PROCESS_TIMEOUT_MS
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, CERTIFICATE_PROCESS_KILL_GRACE_MS);
    }, Math.max(1, timeoutMs));

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      if (timedOut) {
        reject(
          new Error(
            `Certificate process timed out after ${Math.max(1, timeoutMs)}ms`
          )
        );
        return;
      }
      resolve({ code, stderr: stderr.trim() });
    });
  });
}

const defaultProcessRunner: CertificateProcessRunner = {
  run: runCertificateProcess,
};

export async function installCaCertificateElevated(
  certPath: string,
  platform: NodeJS.Platform = process.platform,
  processRunner: CertificateProcessRunner = defaultProcessRunner
): Promise<CertificateInstallResult> {
  if (platform === 'linux') {
    return {
      success: false,
      error: 'Automatic installation is not supported on Linux. Use the terminal commands in the guide.',
    };
  }

  if (platform !== 'darwin' && platform !== 'win32') {
    return {
      success: false,
      error: `Automatic installation is not supported on ${platform}`,
    };
  }

  try {
    const alreadyInstalled = await verifyCaCertificateInstalled(
      platform,
      processRunner
    );
    if (alreadyInstalled) {
      return { success: true };
    }

    if (platform === 'darwin') {
      const script = buildMacInstallScript(certPath);
      const { code, stderr } = await processRunner.run('osascript', ['-e', script]);
      if (code === 0) {
        return { success: true };
      }
      if (await verifyCaCertificateInstalled(platform, processRunner)) {
        return { success: true };
      }
      return {
        success: false,
        error: normalizeInstallError(
          stderr,
          'Installation was cancelled or failed'
        ),
      };
    }

    if (platform === 'win32') {
      const psCommand = buildWindowsInstallCommand(certPath);
      const { code, stderr } = await processRunner.run('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        psCommand,
      ]);
      if (code === 0) {
        return { success: true };
      }
      if (await verifyCaCertificateInstalled(platform, processRunner)) {
        return { success: true };
      }
      return {
        success: false,
        error: normalizeInstallError(
          stderr,
          'Installation was cancelled or failed (UAC denied or error)'
        ),
      };
    }

    return {
      success: false,
      error: 'Automatic installation platform guard was bypassed',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function verifyCaCertificateInstalled(
  platform: NodeJS.Platform = process.platform,
  processRunner: CertificateProcessRunner = defaultProcessRunner
): Promise<boolean> {
  try {
    if (platform === 'darwin') {
      const { code } = await processRunner.run('security', [
        'find-certificate',
        '-c',
        CA_COMMON_NAME,
        '/Library/Keychains/System.keychain',
      ], 10_000);
      return code === 0;
    }

    if (platform === 'win32') {
      const ps = buildWindowsVerifyCommand();
      const { code } = await processRunner.run(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
        15_000
      );
      return code === 0;
    }

    if (platform === 'linux') {
      try {
        await fs.access(LINUX_SYSTEM_CA_PATH);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  } catch {
    return false;
  }
}

export async function uninstallCaCertificate(
  platform: NodeJS.Platform = process.platform,
  processRunner: CertificateProcessRunner = defaultProcessRunner
): Promise<CertificateInstallResult> {
  if (platform === 'linux') {
    return {
      success: false,
      error: LINUX_UNINSTALL_MANUAL_MESSAGE,
    };
  }

  if (platform !== 'darwin' && platform !== 'win32') {
    return {
      success: false,
      error: `Automatic removal is not supported on ${platform}`,
    };
  }

  try {
    const installed = await verifyCaCertificateInstalled(platform, processRunner);
    if (!installed) {
      return { success: true };
    }

    if (platform === 'darwin') {
      const script = buildMacUninstallScript();
      const { code, stderr } = await processRunner.run('osascript', ['-e', script]);
      if (code === 0) {
        return { success: true };
      }
      if (!(await verifyCaCertificateInstalled(platform, processRunner))) {
        return { success: true };
      }
      return {
        success: false,
        error: normalizeInstallError(
          stderr,
          'Certificate removal was cancelled or failed'
        ),
      };
    }

    if (platform === 'win32') {
      const psCommand = buildWindowsUninstallCommand();
      const { code, stderr } = await processRunner.run('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        psCommand,
      ]);
      if (code === 0) {
        return { success: true };
      }
      if (!(await verifyCaCertificateInstalled(platform, processRunner))) {
        return { success: true };
      }
      return {
        success: false,
        error: normalizeInstallError(
          stderr,
          'Certificate removal was cancelled or failed (UAC denied or error)'
        ),
      };
    }

    return {
      success: false,
      error: 'Automatic removal platform guard was bypassed',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
