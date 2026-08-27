import { afterEach, describe, expect, it } from 'vitest';
import {
  VSCodeAPI,
  logBridgeLifecycle,
  type VSCodeApiInstance,
} from './vscodeApi';
import type { FromWebviewMessage, ToWebviewMessage } from '../types';
import { WEBVIEW_STATE_VERSION } from '../types';

function createHostApi() {
  const posted: FromWebviewMessage[] = [];
  let state: ReturnType<VSCodeApiInstance['getState']>;
  const hostApi: VSCodeApiInstance = {
    postMessage: (message) => posted.push(message),
    getState: () => state,
    setState: (nextState) => {
      state = nextState;
    },
  };
  const target = new EventTarget();
  const bridge = new VSCodeAPI(target);
  window.__cursorAccountsVscodeApi = hostApi;

  return { bridge, posted, target, getState: () => state };
}

afterEach(() => {
  window.__cursorAccountsVscodeApi = undefined;
});

describe('VSCodeAPI', () => {
  it('buffers messages until a handler subscribes and stops delivery after unsubscribe', () => {
    const { bridge, target } = createHostApi();
    const message: ToWebviewMessage = { type: 'profiles', data: [] };
    const received: ToWebviewMessage[] = [];

    target.dispatchEvent(new MessageEvent('message', { data: message }));
    const unsubscribe = bridge.onMessage((nextMessage) => received.push(nextMessage));
    expect(received).toEqual([message]);

    target.dispatchEvent(new MessageEvent('message', { data: message }));
    expect(received).toHaveLength(2);

    unsubscribe();
    target.dispatchEvent(new MessageEvent('message', { data: message }));
    expect(received).toHaveLength(2);
  });

  it('ignores message events without a typed payload', () => {
    const { bridge, target } = createHostApi();
    const received: ToWebviewMessage[] = [];
    bridge.onMessage((message) => received.push(message));

    target.dispatchEvent(new Event('message'));
    target.dispatchEvent(
      new MessageEvent('message', { data: { unexpected: true } })
    );

    expect(received).toEqual([]);
  });

  it('maps every webview command to the typed host message contract', () => {
    const { bridge, posted } = createHostApi();

    bridge.requestInit();
    bridge.refresh();
    bridge.requestModelPricing();
    bridge.launch('profile-1', '/workspace');
    bridge.addProfile('user@example.com', 'User', 'dark', '#fff', '🧑');
    bridge.editProfile('profile-1', { displayName: 'Updated' });
    bridge.deleteProfile('profile-1');
    bridge.showInExplorer('profile-1');
    bridge.exportProfiles(['profile-1'], true);
    bridge.importProfiles('{"profiles":[]}', {
      skipDuplicates: true,
      overwriteExisting: false,
      importSettings: true,
      strictValidation: true,
    });
    bridge.requestSuggestedProfile();
    bridge.toggleEfficiency('profile-1', true);
    bridge.requestStorageInfo('profile-1');
    bridge.cleanStorage('profile-1', { action: 'deleteOldChats' });
    bridge.configureGithubToken('profile-1');
    bridge.clearGithubToken('profile-1');
    bridge.startProxy();
    bridge.stopProxy();
    bridge.showProxyLogs();
    bridge.showProxyTraffic();
    bridge.getProxyInstallGuide();
    bridge.installProxyCertificate();
    bridge.uninstallProxyCertificate();
    bridge.saveProxyCertificate();
    bridge.refreshProxyStatus();

    expect(posted.map(({ type }) => type)).toEqual([
      'requestInit',
      'refresh',
      'requestModelPricing',
      'launch',
      'add',
      'edit',
      'delete',
      'showInExplorer',
      'export',
      'import',
      'requestSuggestedProfile',
      'toggleEfficiency',
      'requestStorageInfo',
      'cleanStorage',
      'configureGithubToken',
      'clearGithubToken',
      'startProxy',
      'stopProxy',
      'showProxyLogs',
      'showProxyTraffic',
      'getProxyInstallGuide',
      'installProxyCertificate',
      'uninstallProxyCertificate',
      'saveProxyCertificate',
      'refreshProxyStatus',
    ]);
  });

  it('logs extension diagnostics through the same typed message boundary', () => {
    const { bridge, posted } = createHostApi();

    bridge.logToExtension('debug', 'startup', 'webview ready');
    logBridgeLifecycle('render', 'panel rendered');

    expect(posted).toEqual([
      {
        type: 'webviewLog',
        level: 'debug',
        phase: 'startup',
        message: 'webview ready',
      },
      {
        type: 'webviewLog',
        level: 'info',
        phase: 'render',
        message: 'panel rendered',
      },
    ]);

    window.__cursorAccountsVscodeApi = undefined;
    expect(() => logBridgeLifecycle('early-boot', 'API unavailable')).not.toThrow();
  });

  it('versions persisted state and rejects incompatible state versions', () => {
    const { bridge, getState } = createHostApi();

    bridge.saveState({ showAddForm: true, editingProfileId: 'profile-1' });
    expect(getState()).toEqual({
      version: WEBVIEW_STATE_VERSION,
      showAddForm: true,
      editingProfileId: 'profile-1',
    });
    expect(bridge.getState()).toEqual(getState());

    window.__cursorAccountsVscodeApi = {
      postMessage: () => undefined,
      getState: () => ({ version: WEBVIEW_STATE_VERSION - 1 }),
      setState: () => undefined,
    };
    expect(bridge.getState()).toBeUndefined();
  });

  it('fails clearly when the inline host API is unavailable', () => {
    const { bridge } = createHostApi();
    window.__cursorAccountsVscodeApi = undefined;

    expect(() => bridge.requestInit()).toThrow(
      'VS Code API not initialized'
    );
  });
});
