import React, { useCallback, useEffect, useRef, useState } from 'react';
import { vscodeApi } from './api/vscodeApi';
import { AddProfileForm } from './components/AddProfileForm';
import { EditProfileForm } from './components/EditProfileForm';
import { EmptyState } from './components/EmptyState';
import { ImportDialog } from './components/ImportDialog';
import { ProfileList } from './components/ProfileList';
import { CaCertificateInstallModal } from './components/CaCertificateInstallModal';
import { ProxyStatusCard } from './components/ProxyStatusCard';
import { StorageManagementModal } from './components/StorageManagementModal';
import { L10nProvider, useL10n } from './l10n/context';
import type {
  ImportOptions,
  Profile,
  ProfileAccountMap,
  ProfileAccountView,
  ProfileQuotaMap,
  InstanceInfoMap,
  StorageBreakdown,
  StorageCleanupAction,
  StorageCleanupResult,
  ToWebviewMessage,
  WorkspaceInfo,
  ProfileGithubSummariesMap,
  ProfileGithubTokenStatusMap,
  EfficiencyStatsMap,
  ProxyStatus,
  ProxyInstallGuide,
} from './types';
import './App.css';

const AppContent: React.FC = () => {
  const { t } = useL10n();
  const persisted = vscodeApi.getState();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [quotas, setQuotas] = useState<ProfileQuotaMap>({});
  const [profileAccounts, setProfileAccounts] = useState<ProfileAccountMap>({});
  const [activeAccount, setActiveAccount] = useState<ProfileAccountView | null>(
    null
  );
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [runningInstances, setRunningInstances] = useState<InstanceInfoMap>({});
  const [profileWorkspaces, setProfileWorkspaces] = useState<
    Record<string, WorkspaceInfo[]>
  >({});
  const [openWorkspacePaths, setOpenWorkspacePaths] = useState<string[]>([]);
  const [profileGithubSummaries, setProfileGithubSummaries] =
    useState<ProfileGithubSummariesMap>({});
  const [profileGithubTokenStatus, setProfileGithubTokenStatus] =
    useState<ProfileGithubTokenStatusMap>({});
  const [efficiencyStats, setEfficiencyStats] = useState<EfficiencyStatsMap>({});
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null);
  const [currentWindowUsesProxy, setCurrentWindowUsesProxy] = useState(false);
  const [showCertInstallModal, setShowCertInstallModal] = useState(false);
  const [installGuide, setInstallGuide] = useState<ProxyInstallGuide | null>(
    null
  );
  const [installGuideLoading, setInstallGuideLoading] = useState(false);
  const [installInProgress, setInstallInProgress] = useState(false);
  const [uninstallInProgress, setUninstallInProgress] = useState(false);
  const [showAddForm, setShowAddForm] = useState(
    persisted?.showAddForm ?? false
  );
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [suggestedEmail, setSuggestedEmail] = useState<string | undefined>();
  const [suggestedDisplayName, setSuggestedDisplayName] = useState<
    string | undefined
  >();
  const [suggestedNotice, setSuggestedNotice] = useState<string | undefined>();
  const [editingProfileId, setEditingProfileId] = useState<string | null>(
    persisted?.editingProfileId ?? null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [storageProfileId, setStorageProfileId] = useState<string | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageBreakdown | undefined>();
  const [storageLoading, setStorageLoading] = useState(false);
  const [cleanupInProgress, setCleanupInProgress] = useState(false);
  const [lastCleanupResult, setLastCleanupResult] = useState<
    StorageCleanupResult | undefined
  >();
  const initReceivedRef = useRef(false);

  const persistUiState = useCallback(
    (showAdd: boolean, editingId: string | null) => {
      vscodeApi.saveState({
        showAddForm: showAdd,
        editingProfileId: editingId,
      });
    },
    []
  );

  useEffect(() => {
    const unsubscribe = vscodeApi.onMessage((message: ToWebviewMessage) => {
      switch (message.type) {
        case 'init':
          initReceivedRef.current = true;
          vscodeApi.logToExtension(
            'info',
            'react.init-received',
            `profiles=${message.data.profiles.length}`
          );
          setProfiles(message.data.profiles);
          setCurrentProfile(message.data.currentProfile);
          setQuotas(message.data.quotas ?? {});
          setProfileAccounts(message.data.profileAccounts ?? {});
          setActiveAccount(message.data.activeAccount ?? null);
          setRunningInstances(message.data.runningInstances ?? {});
          setProfileWorkspaces(message.data.profileWorkspaces ?? {});
          setOpenWorkspacePaths(message.data.openWorkspacePaths ?? []);
          setProfileGithubSummaries(
            message.data.profileGithubSummaries ?? {}
          );
          setProfileGithubTokenStatus(
            message.data.profileGithubTokenStatus ?? {}
          );
          setEfficiencyStats(message.data.efficiencyStats ?? {});
          setProxyStatus(message.data.proxyStatus ?? null);
          setCurrentWindowUsesProxy(
            message.data.currentWindowUsesProxy ?? false
          );
          setLoading(false);
          break;

        case 'proxyStatus':
          setProxyStatus(message.data);
          break;

        case 'currentWindowProxyUsage':
          setCurrentWindowUsesProxy(message.usesProxy);
          break;

        case 'proxyInstallGuide':
          setInstallGuide(message.data);
          setInstallGuideLoading(false);
          break;

        case 'certificateInstallResult':
          setInstallInProgress(false);
          if (message.success) {
            setError(null);
            setSuccess(t('proxy.install.installSuccess'));
          } else if (message.error) {
            setSuccess(null);
            setError(
              t('proxy.install.installFailed', { error: message.error })
            );
          }
          break;

        case 'certificateUninstallResult':
          setUninstallInProgress(false);
          if (message.success) {
            setError(null);
            setSuccess(t('proxy.uninstall.success'));
          } else if (message.error) {
            setSuccess(null);
            const errorText = /linux/i.test(message.error)
              ? t('proxy.uninstall.linuxManual')
              : t('proxy.uninstall.failed', { error: message.error });
            setError(errorText);
          }
          break;

        case 'efficiencyStats':
          setEfficiencyStats(message.data);
          break;

        case 'githubSummaries':
          setProfileGithubSummaries(message.data.summaries);
          setProfileGithubTokenStatus(message.data.tokenStatus);
          break;

        case 'openWorkspaces':
          setProfileWorkspaces(message.data.profileWorkspaces);
          setOpenWorkspacePaths(message.data.paths);
          break;

        case 'profiles':
          setProfiles(message.data);
          break;

        case 'quotas':
          setQuotas(message.data);
          break;

        case 'profileAccounts':
          setProfileAccounts(message.data);
          break;

        case 'activeAccount':
          setActiveAccount(message.data);
          break;

        case 'accountsLoading':
          setAccountsLoading(message.data);
          break;

        case 'runningInstances':
          setRunningInstances(message.data);
          break;

        case 'currentProfile':
          setCurrentProfile(message.data);
          break;

        case 'error':
          setLoading(false);
          setError(message.message);
          setTimeout(() => setError(null), 5000);
          break;

        case 'success':
          setSuccess(message.message);
          setTimeout(() => setSuccess(null), 4000);
          break;

        case 'exportData': {
          const blob = new Blob([message.data], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = message.filename;
          anchor.click();
          URL.revokeObjectURL(url);
          break;
        }

        case 'suggestedProfile':
          if (message.notice) {
            setSuggestedEmail(undefined);
            setSuggestedDisplayName(undefined);
            setSuggestedNotice(message.notice);
          } else {
            setSuggestedEmail(message.email);
            setSuggestedDisplayName(message.displayName);
            setSuggestedNotice(undefined);
          }
          break;

        case 'storageInfo':
          if (message.data.profileId === storageProfileId) {
            setStorageInfo(message.data);
            setStorageLoading(false);
          }
          break;

        case 'storageCleanupResult':
          if (storageProfileId) {
            setLastCleanupResult(message.data);
            setCleanupInProgress(false);
            if (message.data.success) {
              setSuccess(message.data.message);
              setTimeout(() => setSuccess(null), 4000);
            } else {
              setError(message.data.message);
              setTimeout(() => setError(null), 5000);
            }
          }
          break;
      }
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
  }, [storageProfileId, t]);

  useEffect(() => {
    if (proxyStatus?.caCertificateInstalled === true && error) {
      setError(null);
    }
  }, [proxyStatus?.caCertificateInstalled, error]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        vscodeApi.refreshProxyStatus();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const handleLaunch = useCallback((profileId: string) => {
    vscodeApi.launch(profileId);
  }, []);

  const handleOpenProject = useCallback(
    (profileId: string, projectPath: string) => {
      vscodeApi.launch(profileId, projectPath);
    },
    []
  );

  const handleEditOpen = useCallback(
    (profileId: string) => {
      setEditingProfileId(profileId);
      persistUiState(showAddForm, profileId);
    },
    [showAddForm, persistUiState]
  );

  const handleEditSubmit = useCallback(
    (profileId: string, updates: Partial<Profile>) => {
      const profile = profiles.find((p) => p.id === profileId);

      if (
        updates.efficiencyAnalysisEnabled !== undefined &&
        profile?.efficiencyAnalysisEnabled !== updates.efficiencyAnalysisEnabled
      ) {
        vscodeApi.toggleEfficiency(profileId, updates.efficiencyAnalysisEnabled);
      }

      const { efficiencyAnalysisEnabled: _efficiency, ...otherUpdates } = updates;

      if (Object.keys(otherUpdates).length > 0) {
        vscodeApi.editProfile(profileId, otherUpdates);
      }

      setEditingProfileId(null);
      persistUiState(showAddForm, null);
    },
    [profiles, showAddForm, persistUiState]
  );

  const handleDelete = useCallback((profileId: string) => {
    vscodeApi.deleteProfile(profileId);
  }, []);

  const handleShowInExplorer = useCallback((profileId: string) => {
    vscodeApi.showInExplorer(profileId);
  }, []);

  const handleAddProfile = useCallback(
    (
      email: string,
      displayName?: string,
      theme?: string,
      color?: string,
      emoji?: string
    ) => {
      vscodeApi.addProfile(email, displayName, theme, color, emoji);
      setShowAddForm(false);
      persistUiState(false, editingProfileId);
    },
    [editingProfileId, persistUiState]
  );

  const openAddForm = useCallback(() => {
    setShowAddForm(true);

    if (!loading) {
      vscodeApi.requestSuggestedProfile();

      setTimeout(() => {
        setSuggestedEmail(undefined);
        setSuggestedDisplayName(undefined);
        setSuggestedNotice(undefined);
      }, 2000);
    }

    persistUiState(true, editingProfileId);
  }, [editingProfileId, persistUiState, loading]);

  const closeAddForm = useCallback(() => {
    setShowAddForm(false);
    setSuggestedEmail(undefined);
    setSuggestedDisplayName(undefined);
    setSuggestedNotice(undefined);
    persistUiState(false, editingProfileId);
  }, [editingProfileId, persistUiState]);

  const closeEditForm = useCallback(() => {
    setEditingProfileId(null);
    persistUiState(showAddForm, null);
  }, [showAddForm, persistUiState]);

  const handleStartProxy = useCallback(() => {
    vscodeApi.startProxy();
  }, []);

  const handleStopProxy = useCallback(() => {
    vscodeApi.stopProxy();
  }, []);

  const handleShowProxyLogs = useCallback(() => {
    vscodeApi.showProxyLogs();
  }, []);

  const handleShowProxyCertificate = useCallback(() => {
    setShowCertInstallModal(true);
    setInstallGuide(null);
    setInstallGuideLoading(true);
    vscodeApi.getProxyInstallGuide();
  }, []);

  const handleCloseCertInstallModal = useCallback(() => {
    setShowCertInstallModal(false);
    setInstallGuide(null);
    setInstallGuideLoading(false);
    setInstallInProgress(false);
  }, []);

  const handleInstallProxyCertificate = useCallback(() => {
    setInstallInProgress(true);
    vscodeApi.installProxyCertificate();
  }, []);

  const handleUninstallProxyCertificate = useCallback(() => {
    const confirmed = window.confirm(
      `${t('proxy.uninstall.confirmTitle')}\n\n${t('proxy.uninstall.confirmBody')}`
    );
    if (!confirmed) {
      return;
    }
    setUninstallInProgress(true);
    vscodeApi.uninstallProxyCertificate();
  }, [t]);

  const handleSaveProxyCertificate = useCallback(() => {
    vscodeApi.saveProxyCertificate();
  }, []);

  const handleExport = useCallback(
    (profileIds: string[], includeSettings: boolean) => {
      vscodeApi.exportProfiles(profileIds, includeSettings);
    },
    []
  );

  const handleImport = useCallback((json: string, options: ImportOptions) => {
    vscodeApi.importProfiles(json, options);
    setShowImportDialog(false);
  }, []);

  const handleManageStorage = useCallback((profileId: string) => {
    setStorageProfileId(profileId);
    setStorageInfo(undefined);
    setStorageLoading(true);
    setCleanupInProgress(false);
    setLastCleanupResult(undefined);
  }, []);

  const handleCloseStorageModal = useCallback(() => {
    setStorageProfileId(null);
    setStorageInfo(undefined);
    setStorageLoading(false);
    setCleanupInProgress(false);
    setLastCleanupResult(undefined);
  }, []);

  const handleRequestStorageInfo = useCallback((profileId: string) => {
    setStorageLoading(true);
    vscodeApi.requestStorageInfo(profileId);
  }, []);

  const handleCleanStorage = useCallback(
    (profileId: string, action: StorageCleanupAction, chatAgeDays?: number) => {
      setCleanupInProgress(true);
      setLastCleanupResult(undefined);
      vscodeApi.cleanStorage(profileId, { action, chatAgeDays });
    },
    []
  );

  const handleConfigureGithubToken = useCallback((profileId: string) => {
    vscodeApi.configureGithubToken(profileId);
  }, []);

  const handleClearGithubToken = useCallback((profileId: string) => {
    vscodeApi.clearGithubToken(profileId);
  }, []);

  const editingProfile = editingProfileId
    ? profiles.find((p) => p.id === editingProfileId)
    : undefined;

  const storageProfile = storageProfileId
    ? profiles.find((p) => p.id === storageProfileId)
    : undefined;

  const activeAccountLabel = (() => {
    if (accountsLoading && !activeAccount?.accountName) {
      return t('app.loadingAccount');
    }
    if (activeAccount?.accountName) {
      return activeAccount.accountName;
    }
    if (currentProfile) {
      return currentProfile.displayName;
    }
    return t('app.defaultProfile');
  })();

  const showActiveFooter =
    accountsLoading || activeAccount != null || currentProfile != null;

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" aria-hidden="true" />
        <p>{t('app.loadingProfiles')}</p>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="app-main">
        <div className="header">
          <h2>{t('app.title')}</h2>
          <div className="header-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowImportDialog(true)}
              title={t('app.importTitle')}
            >
              {t('app.import')}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => vscodeApi.refresh()}
              title={t('app.refreshTitle')}
            >
              ↻
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={openAddForm}
              title={t('app.addTitle')}
            >
              {t('app.add')}
            </button>
          </div>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        {success && (
          <div className="success-banner" role="status">
            {success}
          </div>
        )}

        <ProxyStatusCard
          proxyStatus={proxyStatus}
          currentWindowUsesProxy={currentWindowUsesProxy}
          uninstallInProgress={uninstallInProgress}
          onStartProxy={handleStartProxy}
          onStopProxy={handleStopProxy}
          onShowLogs={handleShowProxyLogs}
          onShowCertificate={handleShowProxyCertificate}
          onSaveCertificate={handleSaveProxyCertificate}
          onDeleteCertificate={handleUninstallProxyCertificate}
        />

        {profiles.length === 0 ? (
          <EmptyState onAddProfile={openAddForm} />
        ) : (
          <ProfileList
            profiles={profiles}
            currentProfileId={currentProfile?.id}
            hasOpenWorkspaceInSession={openWorkspacePaths.length > 0}
            profileAccounts={profileAccounts}
            profileWorkspaces={profileWorkspaces}
            profileGithubSummaries={profileGithubSummaries}
            profileGithubTokenStatus={profileGithubTokenStatus}
            quotas={quotas}
            efficiencyStats={efficiencyStats}
            runningInstances={runningInstances}
            onLaunch={handleLaunch}
            onOpenProject={handleOpenProject}
            onEdit={handleEditOpen}
            onDelete={handleDelete}
            onShowInExplorer={handleShowInExplorer}
            onExport={handleExport}
            onManageStorage={handleManageStorage}
            onConfigureGithubToken={handleConfigureGithubToken}
            onClearGithubToken={handleClearGithubToken}
          />
        )}
      </div>

      {showActiveFooter && (
        <button
          type="button"
          className="active-account-footer"
          disabled
          aria-label={t('app.activeAccount')}
        >
          {currentProfile?.emoji && (
            <span className="active-account-emoji" aria-hidden="true">
              {currentProfile.emoji}
            </span>
          )}
          <span className="active-account-name">{activeAccountLabel}</span>
        </button>
      )}

      {showImportDialog && (
        <ImportDialog
          onImport={handleImport}
          onCancel={() => setShowImportDialog(false)}
        />
      )}

      {showAddForm && (
        <AddProfileForm
          onSubmit={handleAddProfile}
          onCancel={closeAddForm}
          suggestedEmail={suggestedEmail}
          suggestedDisplayName={suggestedDisplayName}
          notice={suggestedNotice}
        />
      )}

      {editingProfile && (
        <EditProfileForm
          profile={editingProfile}
          isCurrent={editingProfile.id === currentProfile?.id}
          onSubmit={(updates) => handleEditSubmit(editingProfile.id, updates)}
          onCancel={closeEditForm}
        />
      )}

      {showCertInstallModal && (
        <CaCertificateInstallModal
          guide={installGuide}
          loading={installGuideLoading}
          installInProgress={installInProgress}
          onClose={handleCloseCertInstallModal}
          onSaveCertificate={handleSaveProxyCertificate}
          onInstallCertificate={handleInstallProxyCertificate}
        />
      )}

      {storageProfile && (
        <StorageManagementModal
          profile={storageProfile}
          isCurrent={storageProfile.id === currentProfile?.id}
          isRunning={storageProfile.id in runningInstances}
          storageInfo={storageInfo}
          storageLoading={storageLoading}
          cleanupInProgress={cleanupInProgress}
          lastCleanupResult={lastCleanupResult}
          onRequestStorageInfo={handleRequestStorageInfo}
          onCleanStorage={handleCleanStorage}
          onClose={handleCloseStorageModal}
        />
      )}
    </div>
  );
};

export const App: React.FC = () => {
  const [locale, setLocale] = useState('en');
  const [messages, setMessages] = useState<Record<string, string>>({});

  useEffect(() => {
    const unsubscribe = vscodeApi.onMessage((message: ToWebviewMessage) => {
      if (message.type === 'init') {
        setLocale(message.data.locale);
        setMessages(message.data.messages);
      }
    });

    return unsubscribe;
  }, []);

  return (
    <L10nProvider locale={locale} messages={messages}>
      <AppContent />
    </L10nProvider>
  );
};
