export type ProxyInstallPlatform = 'darwin' | 'win32' | 'linux';

export type ProxyInstallStepKind = 'text' | 'download' | 'code';

export interface ProxyInstallStep {
  kind: ProxyInstallStepKind;
  title: string;
  body?: string;
  code?: string;
}

export interface ProxyInstallGuide {
  platform: ProxyInstallPlatform;
  certAvailable: boolean;
  certPath?: string;
  title: string;
  intro: string;
  certNotReady?: string;
  steps: ProxyInstallStep[];
}
