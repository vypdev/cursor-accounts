import * as path from 'path';
import { CA_COMMON_NAME } from './certificateConstants';

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
