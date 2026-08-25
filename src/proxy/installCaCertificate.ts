import * as fs from 'fs/promises';
import {
  defaultCertificateProcessRunner,
  type CertificateProcessRunner,
} from './certificateProcessRunner';
import {
  getCertificatePlatformOperations,
  type CertificateInstallResult,
} from './certificatePlatformOperations';

/** System CA file path from the Linux install guide. */
export const LINUX_SYSTEM_CA_PATH =
  '/usr/local/share/ca-certificates/cursor-accounts-mitm.crt';

/** User-facing message when Linux uninstall must be done manually. */
export const LINUX_UNINSTALL_MANUAL_MESSAGE =
  'On Linux, run: sudo rm /usr/local/share/ca-certificates/cursor-accounts-mitm.crt && sudo update-ca-certificates';

export type { CertificateInstallResult, CertificateProcessRunner };
export {
  CERTIFICATE_PROCESS_KILL_GRACE_MS,
  DEFAULT_CERTIFICATE_PROCESS_TIMEOUT_MS,
  runCertificateProcess,
} from './certificateProcessRunner';
export {
  buildMacInstallScript,
  buildMacUninstallScript,
  buildWindowsInstallCommand,
  buildWindowsUninstallCommand,
  buildWindowsVerifyCommand,
  escapePowerShellSingleQuoted,
  escapeShellDoubleQuoted,
} from './certificateCommands';

function unsupportedInstallResult(
  platform: NodeJS.Platform
): CertificateInstallResult {
  return {
    success: false,
    error: `Automatic installation is not supported on ${platform}`,
  };
}

function unsupportedUninstallResult(
  platform: NodeJS.Platform
): CertificateInstallResult {
  return {
    success: false,
    error: `Automatic removal is not supported on ${platform}`,
  };
}

export async function installCaCertificateElevated(
  certPath: string,
  platform: NodeJS.Platform = process.platform,
  processRunner: CertificateProcessRunner = defaultCertificateProcessRunner
): Promise<CertificateInstallResult> {
  if (platform === 'linux') {
    return {
      success: false,
      error:
        'Automatic installation is not supported on Linux. Use the terminal commands in the guide.',
    };
  }

  const operations = getCertificatePlatformOperations(platform);
  if (!operations) {
    return unsupportedInstallResult(platform);
  }

  try {
    if (await operations.verifyInstalled(processRunner)) {
      return { success: true };
    }
    return operations.install(certPath, processRunner);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function verifyCaCertificateInstalled(
  platform: NodeJS.Platform = process.platform,
  processRunner: CertificateProcessRunner = defaultCertificateProcessRunner
): Promise<boolean> {
  if (platform === 'linux') {
    try {
      await fs.access(LINUX_SYSTEM_CA_PATH);
      return true;
    } catch {
      return false;
    }
  }

  const operations = getCertificatePlatformOperations(platform);
  if (!operations) {
    return false;
  }

  try {
    return operations.verifyInstalled(processRunner);
  } catch {
    return false;
  }
}

export async function uninstallCaCertificate(
  platform: NodeJS.Platform = process.platform,
  processRunner: CertificateProcessRunner = defaultCertificateProcessRunner
): Promise<CertificateInstallResult> {
  if (platform === 'linux') {
    return {
      success: false,
      error: LINUX_UNINSTALL_MANUAL_MESSAGE,
    };
  }

  const operations = getCertificatePlatformOperations(platform);
  if (!operations) {
    return unsupportedUninstallResult(platform);
  }

  try {
    if (!(await operations.verifyInstalled(processRunner))) {
      return { success: true };
    }
    return operations.uninstall(processRunner);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
