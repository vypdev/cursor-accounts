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
});
