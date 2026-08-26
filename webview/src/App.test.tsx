import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  InitData,
  Profile,
  ToWebviewMessage,
  WebviewPersistedState,
} from './types';
import { App } from './App';

const bridge = vi.hoisted(() => {
  let handlers: Array<(message: ToWebviewMessage) => void> = [];

  const api = {
    getState: vi.fn(() => undefined as WebviewPersistedState | undefined),
    onMessage: vi.fn((handler: (message: ToWebviewMessage) => void) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((registered) => registered !== handler);
      };
    }),
    logToExtension: vi.fn(),
    requestInit: vi.fn(),
    refresh: vi.fn(),
    requestModelPricing: vi.fn(),
    launch: vi.fn(),
    addProfile: vi.fn(),
    editProfile: vi.fn(),
    deleteProfile: vi.fn(),
    showInExplorer: vi.fn(),
    exportProfiles: vi.fn(),
    importProfiles: vi.fn(),
    requestSuggestedProfile: vi.fn(),
    toggleEfficiency: vi.fn(),
    requestStorageInfo: vi.fn(),
    cleanStorage: vi.fn(),
    configureGithubToken: vi.fn(),
    clearGithubToken: vi.fn(),
    startProxy: vi.fn(),
    stopProxy: vi.fn(),
    showProxyLogs: vi.fn(),
    showProxyTraffic: vi.fn(),
    getProxyInstallGuide: vi.fn(),
    installProxyCertificate: vi.fn(),
    uninstallProxyCertificate: vi.fn(),
    saveProxyCertificate: vi.fn(),
    refreshProxyStatus: vi.fn(),
    saveState: vi.fn(),
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
    },
  };
});

vi.mock('./api/vscodeApi', () => ({ vscodeApi: bridge.api }));

vi.mock('./components/ProfileList', () => ({
  ProfileList: ({
    profiles,
    onLaunch,
    onOpenProject,
    onEdit,
    onDelete,
    onShowInExplorer,
    onExport,
    onManageStorage,
    onConfigureGithubToken,
    onClearGithubToken,
  }: {
    profiles: Profile[];
    onLaunch: (profileId: string) => void;
    onOpenProject: (profileId: string, projectPath: string) => void;
    onEdit: (profileId: string) => void;
    onDelete: (profileId: string) => void;
    onShowInExplorer: (profileId: string) => void;
    onExport: (profileIds: string[], includeSettings: boolean) => void;
    onManageStorage: (profileId: string) => void;
    onConfigureGithubToken: (profileId: string) => void;
    onClearGithubToken: (profileId: string) => void;
  }) => {
    const profileId = profiles[0]?.id ?? 'profile-1';
    return (
      <div data-testid="profile-list">
        <button type="button" data-testid="profile-launch" onClick={() => onLaunch(profileId)}>
          launch
        </button>
        <button
          type="button"
          data-testid="profile-open-project"
          onClick={() => onOpenProject(profileId, '/workspace/project')}
        >
          open project
        </button>
        <button type="button" data-testid="profile-edit" onClick={() => onEdit(profileId)}>
          edit
        </button>
        <button type="button" data-testid="profile-delete" onClick={() => onDelete(profileId)}>
          delete
        </button>
        <button
          type="button"
          data-testid="profile-explorer"
          onClick={() => onShowInExplorer(profileId)}
        >
          explorer
        </button>
        <button
          type="button"
          data-testid="profile-export"
          onClick={() => onExport([profileId], false)}
        >
          export
        </button>
        <button
          type="button"
          data-testid="profile-storage"
          onClick={() => onManageStorage(profileId)}
        >
          storage
        </button>
        <button
          type="button"
          data-testid="profile-github-configure"
          onClick={() => onConfigureGithubToken(profileId)}
        >
          configure github
        </button>
        <button
          type="button"
          data-testid="profile-github-clear"
          onClick={() => onClearGithubToken(profileId)}
        >
          clear github
        </button>
      </div>
    );
  },
}));

const messages: Record<string, string> = {
  'app.title': 'Accounts',
  'app.import': 'Import',
  'app.importTitle': 'Import profiles',
  'app.refreshTitle': 'Refresh',
  'app.add': 'Add profile',
  'app.addTitle': 'Add profile',
  'app.activeAccount': 'Active account',
  'emptyState.title': 'No profiles',
  'emptyState.description': 'Add a profile to begin.',
  'emptyState.button': 'Add profile',
  'addProfile.title': 'Add profile',
  'addProfile.close': 'Close',
  'addProfile.emailLabel': 'Email',
  'addProfile.emailPlaceholder': 'name@example.com',
  'addProfile.displayNameLabel': 'Display name',
  'addProfile.displayNamePlaceholder': 'Name',
  'addProfile.emojiLabel': 'Emoji',
  'addProfile.themeLabel': 'Theme',
  'addProfile.themePlaceholder': 'Theme',
  'addProfile.colorLabel': 'Color',
  'addProfile.cancel': 'Cancel',
  'addProfile.create': 'Create',
  'editProfile.cancel': 'Cancel',
  'editProfile.save': 'Save',
  'import.title': 'Import profiles',
  'import.fileLabel': 'Profile export',
  'import.skipDuplicates': 'Skip duplicates',
  'import.importSettings': 'Import settings',
  'import.cancel': 'Cancel',
  'import.submit': 'Import profiles',
  'proxy.title': 'Proxy',
  'proxy.running': 'Running',
  'proxy.stopped': 'Stopped',
  'proxy.certInstalled': 'Certificate installed',
  'proxy.certNotInstalled': 'Certificate not installed',
  'proxy.start': 'Start proxy',
  'proxy.stop': 'Stop proxy',
  'proxy.viewLogs': 'View logs',
  'proxy.viewTraffic': 'View traffic',
  'proxy.downloadCa': 'Download CA certificate',
  'proxy.caCertificate': 'CA certificate',
  'proxy.deleteCertificate': 'Delete certificate',
  'proxy.deleteCertificateTitle': 'Delete certificate',
  'proxy.install.title': 'Install certificate',
  'proxy.install.loading': 'Loading certificate guide',
  'proxy.install.close': 'Close',
  'proxy.install.installInProgress': 'Installing',
  'proxy.install.installSuccess': 'Certificate installed',
  'proxy.install.installFailed': 'Certificate install failed: {error}',
  'proxy.uninstall.confirmTitle': 'Uninstall certificate',
  'proxy.uninstall.confirmBody': 'Confirm certificate removal.',
  'proxy.uninstall.cancel': 'Cancel',
  'proxy.uninstall.confirm': 'Confirm',
  'proxy.uninstall.success': 'Certificate removed',
  'proxy.uninstall.failed': 'Certificate removal failed: {error}',
  'proxy.uninstall.inProgress': 'Removing',
  'storage.title': 'Storage',
  'storage.loading': 'Loading storage',
  'storage.run': 'Run',
  'storage.confirmExtensionCache': 'Clean extension cache?',
};

const profile: Profile = {
  id: 'profile-1',
  email: 'primary@example.com',
  slug: 'primary',
  displayName: 'Primary',
  userDataDir: '/tmp/cursor-primary',
  created: '2026-01-01T00:00:00.000Z',
  emoji: '⭐',
  proxyEnabled: true,
};

const baseInitData: InitData = {
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
  messages,
};

function initMessage(overrides: Partial<InitData> = {}): ToWebviewMessage {
  return {
    type: 'init',
    data: { ...baseInitData, ...overrides },
  };
}

function renderInitialized(overrides: Partial<InitData> = {}): void {
  render(<App />);
  act(() => {
    bridge.emit(initMessage(overrides));
  });
}

describe('App host/webview integration', () => {
  beforeEach(() => {
    bridge.reset();
    vi.clearAllMocks();
    bridge.api.getState.mockReturnValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    vi.useRealTimers();
  });

  it('requests initialization after the bounded fallback delay', () => {
    render(<App />);

    expect(document.querySelector('.loading')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(bridge.api.requestInit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(bridge.api.requestInit).toHaveBeenCalledOnce();
    expect(bridge.api.logToExtension).toHaveBeenCalledWith(
      'info',
      'react.requestInit-fallback',
      'init not received after 1s'
    );
  });

  it('hydrates an empty state and submits a new profile through the bridge', () => {
    renderInitialized();

    expect(screen.getByRole('heading', { name: 'Accounts' })).toBeInTheDocument();
    expect(screen.getByText('No profiles')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Add profile'));
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(bridge.api.requestSuggestedProfile).toHaveBeenCalledOnce();
    expect(bridge.api.addProfile).toHaveBeenCalledWith(
      'new@example.com',
      undefined,
      undefined,
      '#3b82f6',
      '👤'
    );
    expect(bridge.api.saveState).toHaveBeenLastCalledWith({
      showAddForm: false,
      editingProfileId: null,
    });
  });

  it('forwards profile actions and keeps editing and storage state scoped', () => {
    renderInitialized({ profiles: [profile] });

    fireEvent.click(screen.getByTestId('profile-launch'));
    fireEvent.click(screen.getByTestId('profile-open-project'));
    fireEvent.click(screen.getByTestId('profile-delete'));
    fireEvent.click(screen.getByTestId('profile-explorer'));
    fireEvent.click(screen.getByTestId('profile-export'));
    fireEvent.click(screen.getByTestId('profile-github-configure'));
    fireEvent.click(screen.getByTestId('profile-github-clear'));

    expect(bridge.api.launch).toHaveBeenNthCalledWith(1, 'profile-1');
    expect(bridge.api.launch).toHaveBeenNthCalledWith(
      2,
      'profile-1',
      '/workspace/project'
    );
    expect(bridge.api.deleteProfile).toHaveBeenCalledWith('profile-1');
    expect(bridge.api.showInExplorer).toHaveBeenCalledWith('profile-1');
    expect(bridge.api.exportProfiles).toHaveBeenCalledWith(['profile-1'], false);
    expect(bridge.api.configureGithubToken).toHaveBeenCalledWith('profile-1');
    expect(bridge.api.clearGithubToken).toHaveBeenCalledWith('profile-1');

    fireEvent.click(screen.getByTestId('profile-edit'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(bridge.api.saveState).toHaveBeenLastCalledWith({
      showAddForm: false,
      editingProfileId: null,
    });

    fireEvent.click(screen.getByTestId('profile-storage'));
    expect(bridge.api.requestStorageInfo).toHaveBeenCalledWith('profile-1');
  });

  it('covers header commands and modal actions through the public UI contract', async () => {
    renderInitialized({ profiles: [profile] });

    fireEvent.click(screen.getByTitle('Refresh'));
    expect(bridge.api.refresh).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTitle('Import profiles'));
    const importFile = new File(['{"profiles":[]}'], 'profiles.json', {
      type: 'application/json',
    });
    Object.defineProperty(importFile, 'text', {
      configurable: true,
      value: () => Promise.resolve('{"profiles":[]}'),
    });
    fireEvent.change(screen.getByLabelText('Profile export'), {
      target: { files: [importFile] },
    });
    await act(() =>
      Promise.resolve(
        fireEvent.click(screen.getByRole('button', { name: 'Import profiles' }))
      )
    );
    expect(bridge.api.importProfiles).toHaveBeenCalledWith(
      '{"profiles":[]}',
      {
        skipDuplicates: true,
        overwriteExisting: false,
        importSettings: false,
        strictValidation: true,
      }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Prices' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getAllByRole('button', {
        name: 'Close',
      })[0]!
    );
    expect(bridge.api.requestModelPricing).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId('profile-edit'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(bridge.api.editProfile).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({ displayName: 'Primary' })
    );

    fireEvent.click(screen.getByTestId('profile-storage'));
    let storageDialog = screen.getByRole('dialog');
    fireEvent.click(
      within(storageDialog).getByRole('button', { name: 'Close' })
    );

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByTestId('profile-storage'));
    storageDialog = screen.getByRole('dialog');
    const runButtons = within(storageDialog).getAllByRole('button', {
      name: 'Run',
    });
    fireEvent.click(runButtons[2]!);
    expect(bridge.api.cleanStorage).toHaveBeenCalledWith('profile-1', {
      action: 'cleanExtensionCache',
      chatAgeDays: undefined,
    });
    confirmSpy.mockRestore();

    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' })
    );
    fireEvent.click(screen.getByTitle('Add profile'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(bridge.api.saveState).toHaveBeenCalledWith({
      showAddForm: false,
      editingProfileId: null,
    });
  });

  it('coordinates proxy actions, certificate installation, and host messages', () => {
    renderInitialized({
      profiles: [profile],
      currentProfile: profile,
      proxyStatus: {
        running: false,
        caCertificateInstalled: false,
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start proxy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download CA certificate' }));
    fireEvent.click(screen.getByRole('button', { name: 'CA certificate' }));
    expect(bridge.api.startProxy).toHaveBeenCalledOnce();
    expect(bridge.api.saveProxyCertificate).toHaveBeenCalledOnce();
    expect(bridge.api.getProxyInstallGuide).toHaveBeenCalledOnce();

    act(() => {
      bridge.emit({
        type: 'proxyInstallGuide',
        data: {
          platform: 'linux',
          certAvailable: true,
          title: 'Install certificate',
          intro: 'Install the certificate.',
          steps: [{ kind: 'install', title: 'Install' }],
        },
      });
    });
    fireEvent.click(
      within(screen.getByRole('dialog')).getAllByRole('button', {
        name: 'Close',
      })[0]!
    );
    fireEvent.click(screen.getByRole('button', { name: 'CA certificate' }));
    act(() => {
      bridge.emit({
        type: 'proxyInstallGuide',
        data: {
          platform: 'linux',
          certAvailable: true,
          title: 'Install certificate',
          intro: 'Install the certificate.',
          steps: [{ kind: 'install', title: 'Install' }],
        },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(bridge.api.installProxyCertificate).toHaveBeenCalledOnce();

    act(() => {
      bridge.emit({ type: 'certificateInstallResult', success: true });
      bridge.emit({ type: 'error', message: 'Temporary failure' });
      bridge.emit({ type: 'success', message: 'Recovered' });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Temporary failure');
    expect(screen.getByRole('status')).toHaveTextContent('Recovered');
    fireEvent.click(
      within(screen.getByRole('dialog')).getAllByRole('button', {
        name: 'Close',
      })[0]!
    );

    act(() => {
      bridge.emit({
        type: 'proxyStatus',
        data: { running: true, port: 8080, caCertificateInstalled: true },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop proxy' }));
    fireEvent.click(screen.getByRole('button', { name: 'View logs' }));
    fireEvent.click(screen.getByRole('button', { name: 'View traffic' }));
    expect(bridge.api.stopProxy).toHaveBeenCalledOnce();
    expect(bridge.api.showProxyLogs).toHaveBeenCalledOnce();
    expect(bridge.api.showProxyTraffic).toHaveBeenCalledOnce();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    fireEvent(document, new Event('visibilitychange'));
    expect(bridge.api.refreshProxyStatus).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Delete certificate' }));
    const uninstallDialog = screen.getByRole('dialog', {
      name: 'Uninstall certificate',
    });
    fireEvent.click(
      within(uninstallDialog).getAllByRole('button', { name: 'Cancel' })[1]!
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete certificate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(bridge.api.uninstallProxyCertificate).toHaveBeenCalledOnce();
  });
});
