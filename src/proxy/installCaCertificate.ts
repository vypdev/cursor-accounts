import { spawn } from 'child_process';
import * as path from 'path';
import { CA_COMMON_NAME } from './certificateManager';

export interface CertificateInstallResult {
  success: boolean;
  error?: string;
}

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

export function buildWindowsInstallCommand(certPath: string): string {
  const filePath = escapePowerShellSingleQuoted(path.normalize(certPath));
  const importCmd = `Import-Certificate -FilePath '${filePath}' -CertStoreLocation Cert:\\LocalMachine\\Root`;
  const escapedInner = importCmd.replace(/'/g, "''");
  return `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command','${escapedInner}'`;
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs = 120_000
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Certificate installation timed out'));
    }, timeoutMs);

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr: stderr.trim() });
    });
  });
}

export async function installCaCertificateElevated(
  certPath: string,
  platform: NodeJS.Platform = process.platform
): Promise<CertificateInstallResult> {
  if (platform === 'linux') {
    return {
      success: false,
      error: 'Automatic installation is not supported on Linux. Use the terminal commands in the guide.',
    };
  }

  try {
    if (platform === 'darwin') {
      const script = buildMacInstallScript(certPath);
      const { code, stderr } = await runProcess('osascript', ['-e', script]);
      if (code === 0) {
        return { success: true };
      }
      const message = stderr || 'Installation was cancelled or failed';
      if (/User canceled|canceled/i.test(message)) {
        return { success: false, error: message };
      }
      return { success: false, error: message };
    }

    if (platform === 'win32') {
      const psCommand = buildWindowsInstallCommand(certPath);
      const { code, stderr } = await runProcess('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        psCommand,
      ]);
      if (code === 0) {
        return { success: true };
      }
      return {
        success: false,
        error: stderr || 'Installation was cancelled or failed (UAC denied or error)',
      };
    }

    return {
      success: false,
      error: `Automatic installation is not supported on ${platform}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function verifyCaCertificateInstalled(
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  try {
    if (platform === 'darwin') {
      const { code } = await runProcess('security', [
        'find-certificate',
        '-c',
        CA_COMMON_NAME,
        '/Library/Keychains/System.keychain',
      ], 10_000);
      return code === 0;
    }

    if (platform === 'win32') {
      const ps = `Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object { $_.Subject -like '*${CA_COMMON_NAME.replace(/'/g, "''")}*' } | Select-Object -First 1`;
      const { code } = await runProcess(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
        15_000
      );
      return code === 0;
    }

    return false;
  } catch {
    return false;
  }
}
