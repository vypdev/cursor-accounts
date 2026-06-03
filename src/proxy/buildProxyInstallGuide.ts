import type {
  ProxyInstallGuide,
  ProxyInstallPlatform,
  ProxyInstallStep,
} from '@cursor-accounts/types';
import { t } from '../l10n';

function resolvePlatform(): ProxyInstallPlatform {
  switch (process.platform) {
    case 'darwin':
      return 'darwin';
    case 'win32':
      return 'win32';
    default:
      return 'linux';
  }
}

function formatCertPath(certPath: string | undefined): string {
  return certPath ?? '';
}

function downloadStep(): ProxyInstallStep {
  return {
    kind: 'download',
    title: t('webview.proxy.install.download.title'),
    body: t('webview.proxy.install.download.body'),
  };
}

function textStep(titleKey: string, bodyKey: string, args?: Record<string, string>): ProxyInstallStep {
  return {
    kind: 'text',
    title: t(titleKey, args),
    body: t(bodyKey, args),
  };
}

function codeStep(titleKey: string, codeKey: string, args: Record<string, string>): ProxyInstallStep {
  return {
    kind: 'code',
    title: t(titleKey),
    code: t(codeKey, args),
  };
}

function buildMacSteps(certPath: string): ProxyInstallStep[] {
  const pathArg = { certPath };
  return [
    downloadStep(),
    textStep(
      'webview.proxy.install.mac.step1.title',
      'webview.proxy.install.mac.step1.body'
    ),
    textStep(
      'webview.proxy.install.mac.step2.title',
      'webview.proxy.install.mac.step2.body'
    ),
    textStep(
      'webview.proxy.install.mac.step3.title',
      'webview.proxy.install.mac.step3.body'
    ),
    textStep(
      'webview.proxy.install.mac.step4.title',
      'webview.proxy.install.mac.step4.body'
    ),
    textStep(
      'webview.proxy.install.mac.step5.title',
      'webview.proxy.install.mac.step5.body'
    ),
    codeStep(
      'webview.proxy.install.mac.code.title',
      'webview.proxy.install.mac.code',
      pathArg
    ),
  ];
}

function buildWinSteps(certPath: string): ProxyInstallStep[] {
  const pathArg = { certPath };
  return [
    downloadStep(),
    textStep(
      'webview.proxy.install.win.step1.title',
      'webview.proxy.install.win.step1.body'
    ),
    textStep(
      'webview.proxy.install.win.step2.title',
      'webview.proxy.install.win.step2.body'
    ),
    textStep(
      'webview.proxy.install.win.step3.title',
      'webview.proxy.install.win.step3.body'
    ),
    codeStep(
      'webview.proxy.install.win.code.title',
      'webview.proxy.install.win.code',
      pathArg
    ),
  ];
}

function buildLinuxSteps(certPath: string): ProxyInstallStep[] {
  const pathArg = { certPath };
  return [
    downloadStep(),
    textStep(
      'webview.proxy.install.linux.step1.title',
      'webview.proxy.install.linux.step1.body'
    ),
    codeStep(
      'webview.proxy.install.command',
      'webview.proxy.install.linux.step1.code',
      pathArg
    ),
    textStep(
      'webview.proxy.install.linux.step2.title',
      'webview.proxy.install.linux.step2.body'
    ),
    codeStep(
      'webview.proxy.install.command',
      'webview.proxy.install.linux.step2.code',
      pathArg
    ),
    textStep(
      'webview.proxy.install.linux.step3.title',
      'webview.proxy.install.linux.step3.body',
      pathArg
    ),
  ];
}

export function buildProxyInstallGuide(options: {
  certPath: string | null;
}): ProxyInstallGuide {
  const platform = resolvePlatform();
  const certAvailable = options.certPath != null;
  const certPath = formatCertPath(options.certPath ?? undefined);

  let steps: ProxyInstallStep[];
  switch (platform) {
    case 'darwin':
      steps = buildMacSteps(certPath);
      break;
    case 'win32':
      steps = buildWinSteps(certPath);
      break;
    default:
      steps = buildLinuxSteps(certPath);
  }

  return {
    platform,
    certAvailable,
    certPath: certAvailable ? certPath : undefined,
    title: t('webview.proxy.install.title'),
    intro: t('webview.proxy.install.intro'),
    certNotReady: certAvailable
      ? undefined
      : t('webview.proxy.install.certNotReady'),
    steps,
  };
}
