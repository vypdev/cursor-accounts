import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initL10nForTests } from '../l10n';
import { buildProxyInstallGuide } from '../proxy/buildProxyInstallGuide';

const enMessages: Record<string, string> = {
  'webview.proxy.install.title': 'Install MITM proxy CA',
  'webview.proxy.install.intro': 'Trust the generated certificate.',
  'webview.proxy.install.certNotReady': 'Start the proxy once.',
  'webview.proxy.install.download.title': 'Download the CA certificate',
  'webview.proxy.install.download.body': 'Save the certificate file.',
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
  it('includes download step and platform-specific steps', () => {
    initL10nForTests(enMessages);
    const guide = buildProxyInstallGuide({
      certPath: '/tmp/ca-cert.pem',
    });

    assert.equal(guide.certAvailable, true);
    assert.equal(guide.certPath, '/tmp/ca-cert.pem');
    assert.ok(guide.steps.length >= 4);
    assert.equal(guide.steps[0]?.kind, 'download');
    assert.ok(
      guide.steps.some(
        (s) => s.kind === 'code' && s.code?.includes('/tmp/ca-cert.pem')
      )
    );
  });

  it('marks cert as unavailable when path is missing', () => {
    initL10nForTests(enMessages);
    const guide = buildProxyInstallGuide({ certPath: null });

    assert.equal(guide.certAvailable, false);
    assert.equal(guide.certNotReady, 'Start the proxy once.');
  });
});
