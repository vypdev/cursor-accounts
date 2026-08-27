import { useEffect, useRef } from 'react';
import type { Dispatch } from 'react';
import { vscodeApi } from '../api/vscodeApi';
import type {
  AppMessageAction,
  AppMessageTranslator,
} from '../appMessageState';
import type { ToWebviewMessage } from '../types';

interface AppMessageBridgeOptions {
  dispatch: Dispatch<AppMessageAction>;
  setInstallGuideLoading: (loading: boolean) => void;
  setInstallInProgress: (inProgress: boolean) => void;
  setUninstallInProgress: (inProgress: boolean) => void;
  setLocale: (locale: string) => void;
  setMessages: (messages: Record<string, string>) => void;
  setShowUninstallConfirm: (show: boolean) => void;
  setStorageLoading: (loading: boolean) => void;
  setCleanupInProgress: (inProgress: boolean) => void;
  storageProfileId: string | null;
  translate: AppMessageTranslator;
}

function downloadExport(data: string, filename: string): void {
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function handleBridgeSideEffects(
  message: ToWebviewMessage,
  options: AppMessageBridgeOptions,
  markInitReceived: () => void
): void {
  switch (message.type) {
    case 'init':
      markInitReceived();
      vscodeApi.logToExtension(
        'info',
        'react.init-received',
        `profiles=${message.data.profiles.length}`
      );
      options.setLocale(message.data.locale);
      options.setMessages(message.data.messages);
      return;
    case 'exportData':
      downloadExport(message.data, message.filename);
      return;
    case 'proxyInstallGuide':
      options.setInstallGuideLoading(false);
      return;
    case 'certificateInstallResult':
      options.setInstallInProgress(false);
      return;
    case 'certificateUninstallResult':
      options.setUninstallInProgress(false);
      options.setShowUninstallConfirm(false);
      return;
    case 'storageInfo':
      if (message.data.profileId === options.storageProfileId) {
        options.setStorageLoading(false);
      }
      return;
    case 'storageCleanupResult':
      if (options.storageProfileId) {
        options.setCleanupInProgress(false);
      }
      return;
    default:
      return;
  }
}

export function useAppMessageBridge({
  dispatch,
  setInstallGuideLoading,
  setInstallInProgress,
  setUninstallInProgress,
  setLocale,
  setMessages,
  setShowUninstallConfirm,
  setStorageLoading,
  setCleanupInProgress,
  storageProfileId,
  translate,
}: AppMessageBridgeOptions): void {
  const initReceivedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = vscodeApi.onMessage((message: ToWebviewMessage) => {
      handleBridgeSideEffects(
        message,
        {
          dispatch,
          setInstallGuideLoading,
          setInstallInProgress,
          setUninstallInProgress,
          setLocale,
          setMessages,
          setShowUninstallConfirm,
          setStorageLoading,
          setCleanupInProgress,
          storageProfileId,
          translate,
        },
        () => {
          initReceivedRef.current = true;
        }
      );

      dispatch({
        type: 'message',
        message,
        storageProfileId,
        translate,
      });
    });

    const fallbackTimer = window.setTimeout(() => {
      if (!initReceivedRef.current) {
        vscodeApi.logToExtension(
          'info',
          'react.requestInit-fallback',
          'init not received after 1s'
        );
        vscodeApi.requestInit();
      }
    }, 1000);

    return () => {
      window.clearTimeout(fallbackTimer);
      unsubscribe();
    };
  }, [
    dispatch,
    setCleanupInProgress,
    setInstallGuideLoading,
    setInstallInProgress,
    setUninstallInProgress,
    setLocale,
    setMessages,
    setShowUninstallConfirm,
    setStorageLoading,
    storageProfileId,
    translate,
  ]);
}
