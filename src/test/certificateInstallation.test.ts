import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildMacInstallScript,
  buildMacUninstallScript,
  buildWindowsInstallCommand,
  buildWindowsUninstallCommand,
  buildWindowsVerifyCommand,
  escapePowerShellSingleQuoted,
  escapeShellDoubleQuoted,
  installCaCertificateElevated,
  LINUX_SYSTEM_CA_PATH,
  LINUX_UNINSTALL_MANUAL_MESSAGE,
  uninstallCaCertificate,
  verifyCaCertificateInstalled,
} from '../proxy/installCaCertificate';
import type { CertificateProcessRunner } from '../proxy/installCaCertificate';

function scriptedRunner(
  results: Array<{ code: number | null; stderr: string }>
): CertificateProcessRunner & { calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  return {
    calls,
    run: async (command, args) => {
      calls.push({ command, args });
      return results.shift() ?? { code: 1, stderr: '' };
    },
  };
}

describe('installCaCertificate command builders', () => {
  it('escapeShellDoubleQuoted escapes quotes and backslashes', () => {
    assert.equal(escapeShellDoubleQuoted('a"b\\c'), 'a\\"b\\\\c');
  });

  it('escapePowerShellSingleQuoted doubles single quotes', () => {
    assert.equal(escapePowerShellSingleQuoted("it's"), "it''s");
  });

  it('buildMacInstallScript includes cert path and security command', () => {
    const script = buildMacInstallScript('/tmp/ca cert.pem');
    assert.match(script, /security add-trusted-cert/);
    assert.match(script, /administrator privileges/);
    assert.match(script, /ca cert\.pem/);
  });

  it('buildWindowsInstallCommand includes Import-Certificate and RunAs', () => {
    const cmd = buildWindowsInstallCommand('C:\\Users\\test\\ca.pem');
    assert.match(cmd, /Import-Certificate/);
    assert.match(cmd, /RunAs/);
    assert.match(cmd, /LocalMachine/);
    assert.match(cmd, /ca\.pem/);
  });

  it('buildWindowsVerifyCommand exits non-zero when cert is missing', () => {
    const cmd = buildWindowsVerifyCommand();
    assert.match(cmd, /exit 1/);
    assert.match(cmd, /\$null -eq \$cert/);
  });

  it('LINUX_SYSTEM_CA_PATH matches install guide', () => {
    assert.equal(
      LINUX_SYSTEM_CA_PATH,
      '/usr/local/share/ca-certificates/cursor-accounts-mitm.crt'
    );
  });

  it('buildMacUninstallScript includes delete-certificate and administrator privileges', () => {
    const script = buildMacUninstallScript();
    assert.match(script, /security delete-certificate/);
    assert.match(script, /administrator privileges/);
    assert.match(script, /Cursor Accounts MITM Proxy CA/);
  });

  it('buildWindowsUninstallCommand includes certutil and RunAs', () => {
    const cmd = buildWindowsUninstallCommand();
    assert.match(cmd, /certutil -delstore Root/);
    assert.match(cmd, /RunAs/);
    assert.match(cmd, /Cursor Accounts MITM Proxy CA/);
  });

  it('LINUX_UNINSTALL_MANUAL_MESSAGE references system CA path', () => {
    assert.match(LINUX_UNINSTALL_MANUAL_MESSAGE, /cursor-accounts-mitm\.crt/);
    assert.match(LINUX_UNINSTALL_MANUAL_MESSAGE, /update-ca-certificates/);
  });

  it('keeps Linux installation and removal manual', async () => {
    assert.deepEqual(await installCaCertificateElevated('/tmp/ca.pem', 'linux'), {
      success: false,
      error:
        'Automatic installation is not supported on Linux. Use the terminal commands in the guide.',
    });
    assert.deepEqual(await uninstallCaCertificate('linux'), {
      success: false,
      error: LINUX_UNINSTALL_MANUAL_MESSAGE,
    });
  });

  it('rejects unsupported platforms without spawning a process', async () => {
    assert.deepEqual(await installCaCertificateElevated('/tmp/ca.pem', 'aix'), {
      success: false,
      error: 'Automatic installation is not supported on aix',
    });
    assert.deepEqual(await uninstallCaCertificate('aix'), {
      success: false,
      error: 'Automatic removal is not supported on aix',
    });
    assert.equal(await verifyCaCertificateInstalled('aix'), false);
  });

  it('installs on macOS through the injected process runner', async () => {
    const runner = scriptedRunner([
      { code: 1, stderr: '' },
      { code: 0, stderr: '' },
    ]);

    const result = await installCaCertificateElevated(
      '/tmp/ca cert.pem',
      'darwin',
      runner
    );

    assert.deepEqual(result, { success: true });
    assert.deepEqual(
      runner.calls.map(({ command }) => command),
      ['security', 'osascript']
    );
  });

  it('normalizes macOS permission failures after post-install verification', async () => {
    const runner = scriptedRunner([
      { code: 1, stderr: '' },
      { code: 1, stderr: 'not authorized to modify keychain' },
      { code: 1, stderr: '' },
    ]);

    const result = await installCaCertificateElevated('/tmp/ca.pem', 'darwin', runner);

    assert.deepEqual(result, { success: false, error: 'Permission denied' });
  });

  it('treats a cancelled Windows install as failure when verification is absent', async () => {
    const runner = scriptedRunner([
      { code: 1, stderr: '' },
      { code: 1, stderr: 'User canceled the operation' },
      { code: 1, stderr: '' },
    ]);

    const result = await installCaCertificateElevated('C:\\ca.pem', 'win32', runner);

    assert.deepEqual(result, {
      success: false,
      error: 'Installation canceled by user',
    });
  });

  it('considers Windows removal complete when post-removal verification is absent', async () => {
    const runner = scriptedRunner([
      { code: 0, stderr: '' },
      { code: 1, stderr: '' },
    ]);

    const result = await uninstallCaCertificate('win32', runner);

    assert.deepEqual(result, { success: true });
    assert.deepEqual(runner.calls.map(({ command }) => command), [
      'powershell.exe',
      'powershell.exe',
      'powershell.exe',
    ]);
  });
});
