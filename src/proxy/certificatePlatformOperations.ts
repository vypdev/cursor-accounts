import {
  buildMacInstallScript,
  buildMacUninstallScript,
  buildWindowsInstallCommand,
  buildWindowsUninstallCommand,
  buildWindowsVerifyCommand,
} from './certificateCommands';
import { CA_COMMON_NAME } from './certificateConstants';
import type { CertificateProcessRunner } from './certificateProcessRunner';

export interface CertificateInstallResult {
  success: boolean;
  error?: string;
}

interface CertificatePlatformOperations {
  verifyInstalled(processRunner: CertificateProcessRunner): Promise<boolean>;
  install(
    certPath: string,
    processRunner: CertificateProcessRunner
  ): Promise<CertificateInstallResult>;
  uninstall(
    processRunner: CertificateProcessRunner
  ): Promise<CertificateInstallResult>;
}

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

async function executeCertificateCommand(
  processRunner: CertificateProcessRunner,
  command: string,
  args: string[],
  verifyInstalled: () => Promise<boolean>,
  failureFallback: string,
  successWhenVerified: boolean
): Promise<CertificateInstallResult> {
  const { code, stderr } = await processRunner.run(command, args);
  if (code === 0) {
    return { success: true };
  }
  if ((await verifyInstalled()) === successWhenVerified) {
    return { success: true };
  }
  return {
    success: false,
    error: normalizeInstallError(stderr, failureFallback),
  };
}

const darwinCertificateOperations: CertificatePlatformOperations = {
  async verifyInstalled(processRunner) {
    const { code } = await processRunner.run(
      'security',
      ['find-certificate', '-c', CA_COMMON_NAME, '/Library/Keychains/System.keychain'],
      10_000
    );
    return code === 0;
  },

  async install(certPath, processRunner) {
    return executeCertificateCommand(
      processRunner,
      'osascript',
      ['-e', buildMacInstallScript(certPath)],
      () => darwinCertificateOperations.verifyInstalled(processRunner),
      'Installation was cancelled or failed',
      true
    );
  },

  async uninstall(processRunner) {
    return executeCertificateCommand(
      processRunner,
      'osascript',
      ['-e', buildMacUninstallScript()],
      () => darwinCertificateOperations.verifyInstalled(processRunner),
      'Certificate removal was cancelled or failed',
      false
    );
  },
};

const windowsCertificateOperations: CertificatePlatformOperations = {
  async verifyInstalled(processRunner) {
    const { code } = await processRunner.run(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', buildWindowsVerifyCommand()],
      15_000
    );
    return code === 0;
  },

  async install(certPath, processRunner) {
    return executeCertificateCommand(
      processRunner,
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        buildWindowsInstallCommand(certPath),
      ],
      () => windowsCertificateOperations.verifyInstalled(processRunner),
      'Installation was cancelled or failed (UAC denied or error)',
      true
    );
  },

  async uninstall(processRunner) {
    return executeCertificateCommand(
      processRunner,
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        buildWindowsUninstallCommand(),
      ],
      () => windowsCertificateOperations.verifyInstalled(processRunner),
      'Certificate removal was cancelled or failed (UAC denied or error)',
      false
    );
  },
};

export function getCertificatePlatformOperations(
  platform: NodeJS.Platform
): CertificatePlatformOperations | undefined {
  if (platform === 'darwin') {
    return darwinCertificateOperations;
  }
  if (platform === 'win32') {
    return windowsCertificateOperations;
  }
  return undefined;
}
