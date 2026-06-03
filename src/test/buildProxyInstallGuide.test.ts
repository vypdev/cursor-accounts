import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { initL10nForTests } from '../l10n';
import { buildProxyInstallGuide } from '../proxy/buildProxyInstallGuide';

const enMessages: Record<string, string> = {
  'webview.proxy.install.title': 'Install MITM proxy CA',
  'webview.proxy.install.intro': 'Trust the generated certificate.',
  'webview.proxy.install.certNotReady': 'Start the proxy once.',
  'webview.proxy.install.download.title': 'Download the CA certificate',
  'webview.proxy.install.download.body': 'Save the certificate file.',
  'webview.proxy.install.copyCode': 'Copy',
  'webview.proxy.install.copied': 'Copied',
  'webview.proxy.install.loading': 'Loading…',
  'webview.proxy.install.close': 'Close',
  'webview.proxy.install.mac.autoInstall.button': 'Install to Keychain',
  'webview.proxy.install.mac.autoInstall.body': 'Keychain prompt.',
  'webview.proxy.install.win.autoInstall.button': 'Install certificate',
  'webview.proxy.install.win.autoInstall.body': 'UAC prompt.',
  'webview.proxy.install.manual.title': 'Manual installation',
  'webview.proxy.install.manual.intro': 'Alternative steps.',
  'webview.proxy.install.command': 'Command',
  'webview.proxy.install.mac.step1.title': 'Open Keychain Access',
  'webview.proxy.install.mac.step1.body': 'Open Keychain Access app.',
  'webview.proxy.install.mac.step2.title': 'Import',
  'webview.proxy.install.mac.step2.body': 'Import pem.',
  'webview.proxy.install.mac.step3.title': 'Open cert',
  'webview.proxy.install.mac.step3.body': 'Double-click.',
  'webview.proxy.install.mac.step4.title': 'Trust',
  'webview.proxy.install.mac.step4.body': 'Always Trust.',
  'webview.proxy.install.mac.step5.title': 'Confirm',
  'webview.proxy.install.mac.step5.body': 'Enter password.',
  'webview.proxy.install.mac.code.title': 'Terminal',
  'webview.proxy.install.mac.code': 'sudo security {certPath}',
  'webview.proxy.install.win.step1.title': 'Open file',
  'webview.proxy.install.win.step1.body': 'Double-click pem.',
  'webview.proxy.install.win.step2.title': 'Wizard',
  'webview.proxy.install.win.step2.body': 'Install to root.',
  'webview.proxy.install.win.step3.title': 'Finish',
  'webview.proxy.install.win.step3.body': 'Complete wizard.',
  'webview.proxy.install.win.code.title': 'PowerShell',
  'webview.proxy.install.win.code': 'Import-Certificate {certPath}',
  'webview.proxy.install.linux.step1.title': 'Copy',
  'webview.proxy.install.linux.step1.body': 'Copy cert.',
  'webview.proxy.install.linux.step1.code': 'sudo cp {certPath}',
  'webview.proxy.install.linux.step2.title': 'Update',
  'webview.proxy.install.linux.step2.body': 'Update CAs.',
  'webview.proxy.install.linux.step2.code': 'sudo update-ca-certificates',
  'webview.proxy.install.linux.step3.title': 'Electron',
  'webview.proxy.install.linux.step3.body': 'NODE_EXTRA_CA_CERTS={certPath}',
};

describe('buildProxyInstallGuide', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    initL10nForTests(enMessages);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  it('includes install step first on macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const guide = buildProxyInstallGuide({ certPath: '/tmp/ca-cert.pem' });

    assert.equal(guide.certAvailable, true);
    assert.equal(guide.certPath, '/tmp/ca-cert.pem');
    assert.equal(guide.steps[0]?.kind, 'install');
    assert.ok(guide.steps.some((s) => s.kind === 'download'));
    assert.ok(
      guide.steps.some(
        (s) => s.kind === 'code' && s.code?.includes('/tmp/ca-cert.pem')
      )
    );
  });

  it('includes install step first on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const guide = buildProxyInstallGuide({ certPath: 'C:\\ca.pem' });

    assert.equal(guide.steps[0]?.kind, 'install');
    assert.ok(guide.steps.some((s) => s.kind === 'code'));
  });

  it('does not include install step on Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const guide = buildProxyInstallGuide({ certPath: '/tmp/ca-cert.pem' });

    assert.ok(!guide.steps.some((s) => s.kind === 'install'));
    assert.equal(guide.steps[0]?.kind, 'download');
  });

  it('marks cert as unavailable when path is missing', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const guide = buildProxyInstallGuide({ certPath: null });

    assert.equal(guide.certAvailable, false);
    assert.equal(guide.certNotReady, 'Start the proxy once.');
  });
});
