import type { ToWebviewMessage } from './types';
import type {
  AppMessageState,
  AppMessageTranslator,
} from './appMessageStateTypes';

export type AppProxyMessage = Extract<
  ToWebviewMessage,
  {
    type:
      | 'proxyStatus'
      | 'currentWindowProxyUsage'
      | 'proxyInstallGuide'
      | 'certificateInstallResult'
      | 'certificateUninstallResult';
  }
>;

export function applyProxyMessage(
  state: AppMessageState,
  message: AppProxyMessage,
  translate: AppMessageTranslator
): AppMessageState {
  switch (message.type) {
    case 'proxyStatus':
      return {
        ...state,
        proxyStatus: message.data,
        error:
          message.data?.caCertificateInstalled === true ? null : state.error,
      };
    case 'currentWindowProxyUsage':
      return { ...state, currentWindowUsesProxy: message.usesProxy };
    case 'proxyInstallGuide':
      return { ...state, installGuide: message.data };
    case 'certificateInstallResult':
      return applyCertificateInstallResult(state, message, translate);
    case 'certificateUninstallResult':
      return applyCertificateUninstallResult(state, message, translate);
  }
}

function applyCertificateInstallResult(
  state: AppMessageState,
  message: Extract<ToWebviewMessage, { type: 'certificateInstallResult' }>,
  translate: AppMessageTranslator
): AppMessageState {
  if (message.success) {
    return {
      ...state,
      error: null,
      success: translate('proxy.install.installSuccess'),
    };
  }
  if (!message.error) {
    return state;
  }
  return {
    ...state,
    success: null,
    error: translate('proxy.install.installFailed', { error: message.error }),
  };
}

function applyCertificateUninstallResult(
  state: AppMessageState,
  message: Extract<ToWebviewMessage, { type: 'certificateUninstallResult' }>,
  translate: AppMessageTranslator
): AppMessageState {
  if (message.success) {
    return {
      ...state,
      error: null,
      success: translate('proxy.uninstall.success'),
    };
  }
  if (!message.error) {
    return state;
  }
  return {
    ...state,
    success: null,
    error: /linux/i.test(message.error)
      ? translate('proxy.uninstall.linuxManual')
      : translate('proxy.uninstall.failed', { error: message.error }),
  };
}
