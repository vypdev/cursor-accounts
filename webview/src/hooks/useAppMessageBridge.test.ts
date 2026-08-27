import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyStorageBreakdown,
  type InitData,
  type ToWebviewMessage,
} from '../types';
import { useAppMessageBridge } from './useAppMessageBridge';

const bridge = vi.hoisted(() => {
  let handlers: Array<(message: ToWebviewMessage) => void> = [];
  const unsubscribe = vi.fn();

  const api = {
    onMessage: vi.fn((handler: (message: ToWebviewMessage) => void) => {
      handlers.push(handler);
      return () => {
        unsubscribe();
        handlers = handlers.filter((registered) => registered !== handler);
      };
    }),
    logToExtension: vi.fn(),
    requestInit: vi.fn(),
  };

  return {
    api,
    emit(message: ToWebviewMessage): void {
      for (const handler of [...handlers]) {
        handler(message);
      }
    },
    reset(): void {
      handlers = [];
      unsubscribe.mockClear();
    },
    unsubscribe,
  };
});

vi.mock('../api/vscodeApi', () => ({ vscodeApi: bridge.api }));

const initData = {
  profiles: [],
  profileWorkspaces: {},
  currentProfile: null,
  quotas: {},
  profileAccounts: {},
  activeAccount: null,
  runningInstances: {},
  openWorkspacePaths: [],
  profileGithubSummaries: {},
  profileGithubTokenStatus: {},
  efficiencyStats: {},
  proxyStatus: null,
  currentWindowUsesProxy: false,
  profileProxyTemporary: {},
  locale: 'en',
  messages: { 'app.title': 'Accounts' },
} satisfies InitData;

function createOptions(): Parameters<typeof useAppMessageBridge>[0] {
  return {
    dispatch: vi.fn(),
    setInstallGuideLoading: vi.fn(),
    setInstallInProgress: vi.fn(),
    setUninstallInProgress: vi.fn(),
    setLocale: vi.fn(),
    setMessages: vi.fn(),
    setShowUninstallConfirm: vi.fn(),
    setStorageLoading: vi.fn(),
    setCleanupInProgress: vi.fn(),
    storageProfileId: 'profile-1',
    translate: vi.fn((key: string) => key),
  };
}

describe('useAppMessageBridge', () => {
  beforeEach(() => {
    bridge.reset();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwards initialization and host side effects to the application', () => {
    const options = createOptions();
    renderHook(() => useAppMessageBridge(options));

    const initMessage: ToWebviewMessage = {
      type: 'init',
      data: initData,
    };
    act(() => {
      bridge.emit(initMessage);
      bridge.emit({
        type: 'proxyInstallGuide',
        data: {
          platform: 'linux',
          certAvailable: false,
          title: 'Install certificate',
          intro: 'Install the certificate.',
          steps: [],
        },
      });
      bridge.emit({ type: 'certificateInstallResult', success: true });
      bridge.emit({ type: 'certificateUninstallResult', success: true });
      bridge.emit({
        type: 'storageInfo',
        data: createEmptyStorageBreakdown('profile-1'),
      });
      bridge.emit({
        type: 'storageCleanupResult',
        data: { success: true, bytesReclaimed: 1, message: 'Cleaned' },
      });
    });

    expect(options.setLocale).toHaveBeenCalledWith('en');
    expect(options.setMessages).toHaveBeenCalledWith(initData.messages);
    expect(bridge.api.logToExtension).toHaveBeenCalledWith(
      'info',
      'react.init-received',
      'profiles=0'
    );
    expect(options.setInstallGuideLoading).toHaveBeenCalledWith(false);
    expect(options.setInstallInProgress).toHaveBeenCalledWith(false);
    expect(options.setUninstallInProgress).toHaveBeenCalledWith(false);
    expect(options.setShowUninstallConfirm).toHaveBeenCalledWith(false);
    expect(options.setStorageLoading).toHaveBeenCalledWith(false);
    expect(options.setCleanupInProgress).toHaveBeenCalledWith(false);
    expect(options.dispatch).toHaveBeenCalledTimes(6);
  });

  it('downloads export data and ignores unrelated storage responses', () => {
    const options = createOptions();
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    renderHook(() => useAppMessageBridge(options));
    act(() => {
      bridge.emit({
        type: 'storageInfo',
        data: createEmptyStorageBreakdown('other-profile'),
      });
      bridge.emit({
        type: 'storageCleanupResult',
        data: { success: true, bytesReclaimed: 1, message: 'Cleaned' },
      });
      bridge.emit({
        type: 'exportData',
        filename: 'profiles.json',
        data: '{"profiles":[]}',
      });
    });

    expect(options.setStorageLoading).not.toHaveBeenCalled();
    expect(options.setCleanupInProgress).toHaveBeenCalledWith(false);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('requests initialization once after the bounded fallback and unsubscribes on unmount', () => {
    const options = createOptions();
    const { unmount } = renderHook(() => useAppMessageBridge(options));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(bridge.api.requestInit).toHaveBeenCalledOnce();
    expect(bridge.api.logToExtension).toHaveBeenCalledWith(
      'info',
      'react.requestInit-fallback',
      'init not received after 1s'
    );

    unmount();
    expect(bridge.unsubscribe).toHaveBeenCalledOnce();
  });
});
