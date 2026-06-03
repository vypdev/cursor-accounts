import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildMacInstallScript,
  buildWindowsInstallCommand,
  buildWindowsVerifyCommand,
  escapePowerShellSingleQuoted,
  escapeShellDoubleQuoted,
  LINUX_SYSTEM_CA_PATH,
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
});
