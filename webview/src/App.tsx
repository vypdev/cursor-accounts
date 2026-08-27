import React, { useCallback, useEffect, useReducer, useState } from 'react';
import { vscodeApi } from './api/vscodeApi';
import { EmptyState } from './components/EmptyState';
import { ProfileList } from './components/ProfileList';
import { AppDialogs } from './components/AppDialogs';
import { ProxyStatusCard } from './components/ProxyStatusCard';
import { L10nProvider, useL10n } from './l10n/context';
import type {
  ImportOptions,
  Profile,
  StorageCleanupAction,
} from './types';
import { isProfileProxyEnabled } from './types';
import {
  appMessageReducer,
  createInitialAppMessageState,
} from './appMessageState';
import { useAppMessageBridge } from './hooks/useAppMessageBridge';
import './App.css';

interface AppContentProps {
  setLocale: (locale: string) => void;
  setMessages: (messages: Record<string, string>) => void;
  messages: Record<string, string>;
}

const AppContent: React.FC<AppContentProps> = ({
  setLocale,
  setMessages,
  messages,
}) => {
  const { t } = useL10n();
  const persisted = vscodeApi.getState();
  const [messageState, dispatchAppMessage] = useReducer(
    appMessageReducer,
    undefined,
    createInitialAppMessageState
  );
  const {
    profiles,
    currentProfile,
    quotas,
    profileAccounts,
    activeAccount,
    accountsLoading,
    runningInstances,
    profileWorkspaces,
    openWorkspacePaths,
    profileGithubSummaries,
    profileGithubTokenStatus,
    efficiencyStats,
    proxyStatus,
    currentWindowUsesProxy,
    profileProxyTemporary,
    installGuide,
    suggestedEmail,
    suggestedDisplayName,
    suggestedNotice,
    loading,
    error,
    success,
    storageInfo,
    lastCleanupResult,
    showPricesModal,
    modelPricingData,
    enabledModelPricingData,
    pricingLoading,
  } = messageState;
  const [showCertInstallModal, setShowCertInstallModal] = useState(false);
  const [installGuideLoading, setInstallGuideLoading] = useState(false);
  const [installInProgress, setInstallInProgress] = useState(false);
  const [uninstallInProgress, setUninstallInProgress] = useState(false);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [showAddForm, setShowAddForm] = useState(
    persisted?.showAddForm ?? false
  );
  const [showImportDialog, setShowImportDialog] = useState(false);

  const showProxyUi =
    currentProfile != null && isProfileProxyEnabled(currentProfile);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(
    persisted?.editingProfileId ?? null
  );
  const [storageProfileId, setStorageProfileId] = useState<string | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [cleanupInProgress, setCleanupInProgress] = useState(false);

  const persistUiState = useCallback(
    (showAdd: boolean, editingId: string | null) => {
      vscodeApi.saveState({
        showAddForm: showAdd,
        editingProfileId: editingId,
      });
    },
    []
  );

  useAppMessageBridge({
    dispatch: dispatchAppMessage,
    setInstallGuideLoading,
    setInstallInProgress,
    setUninstallInProgress,
    setLocale,
    setMessages,
    setShowUninstallConfirm,
    setStorageLoading,
    setCleanupInProgress,
    storageProfileId,
    translate: t,
  });

  useEffect(() => {
    if (!error) {
      return;
    }
    const timeout = window.setTimeout(
      () => dispatchAppMessage({ type: 'clearError' }),
      5000
    );
    return () => window.clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    if (!success) {
      return;
    }
    const timeout = window.setTimeout(
      () => dispatchAppMessage({ type: 'clearSuccess' }),
      4000
    );
    return () => window.clearTimeout(timeout);
  }, [success]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && showProxyUi) {
        vscodeApi.refreshProxyStatus();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [showProxyUi]);

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

      const otherUpdates = { ...updates };
      delete otherUpdates.efficiencyAnalysisEnabled;

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
        dispatchAppMessage({ type: 'clearSuggestedProfile' });
      }, 2000);
    }

    persistUiState(true, editingProfileId);
  }, [editingProfileId, persistUiState, loading]);

  const closeAddForm = useCallback(() => {
    setShowAddForm(false);
    dispatchAppMessage({ type: 'clearSuggestedProfile' });
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

  const handleShowProxyTraffic = useCallback(() => {
    vscodeApi.showProxyTraffic();
  }, []);

  const handleShowProxyCertificate = useCallback(() => {
    setShowCertInstallModal(true);
    dispatchAppMessage({ type: 'clearInstallGuide' });
    setInstallGuideLoading(true);
    vscodeApi.getProxyInstallGuide();
  }, []);

  const handleCloseCertInstallModal = useCallback(() => {
    setShowCertInstallModal(false);
    dispatchAppMessage({ type: 'clearInstallGuide' });
    setInstallGuideLoading(false);
    setInstallInProgress(false);
  }, []);

  const handleInstallProxyCertificate = useCallback(() => {
    setInstallInProgress(true);
    vscodeApi.installProxyCertificate();
  }, []);

  const handleOpenUninstallConfirm = useCallback(() => {
    setShowUninstallConfirm(true);
  }, []);

  const handleCloseUninstallConfirm = useCallback(() => {
    if (!uninstallInProgress) {
      setShowUninstallConfirm(false);
    }
  }, [uninstallInProgress]);

  const handleConfirmUninstallProxyCertificate = useCallback(() => {
    setUninstallInProgress(true);
    vscodeApi.uninstallProxyCertificate();
  }, []);

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
    dispatchAppMessage({ type: 'resetStorageMessageState' });
    setStorageLoading(true);
    setCleanupInProgress(false);
  }, []);

  const handleCloseStorageModal = useCallback(() => {
    setStorageProfileId(null);
    dispatchAppMessage({ type: 'resetStorageMessageState' });
    setStorageLoading(false);
    setCleanupInProgress(false);
  }, []);

  const handleRequestStorageInfo = useCallback((profileId: string) => {
    setStorageLoading(true);
    vscodeApi.requestStorageInfo(profileId);
  }, []);

  const handleCleanStorage = useCallback(
    (profileId: string, action: StorageCleanupAction, chatAgeDays?: number) => {
      setCleanupInProgress(true);
      dispatchAppMessage({ type: 'resetStorageMessageState' });
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

  const handleOpenPrices = useCallback(() => {
    dispatchAppMessage({ type: 'beginModelPricingRequest' });
    vscodeApi.requestModelPricing();
  }, []);

  const handleClosePricesModal = useCallback(() => {
    dispatchAppMessage({ type: 'closeModelPricing' });
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
        {messages['app.loadingProfiles'] ? (
          <p>{messages['app.loadingProfiles']}</p>
        ) : null}
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
              onClick={handleOpenPrices}
              title="View model pricing"
            >
              Prices
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

        {showProxyUi && (
          <ProxyStatusCard
            proxyStatus={proxyStatus}
            currentWindowUsesProxy={currentWindowUsesProxy}
            uninstallInProgress={uninstallInProgress}
            onStartProxy={handleStartProxy}
            onStopProxy={handleStopProxy}
            onShowLogs={handleShowProxyLogs}
            onShowTraffic={handleShowProxyTraffic}
            onShowCertificate={handleShowProxyCertificate}
            onSaveCertificate={handleSaveProxyCertificate}
            onDeleteCertificate={handleOpenUninstallConfirm}
          />
        )}

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
            profileProxyTemporary={profileProxyTemporary}
            showProxyIndicators={showProxyUi}
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

      <AppDialogs
        showImportDialog={showImportDialog}
        onImport={handleImport}
        onCloseImport={() => setShowImportDialog(false)}
        showAddForm={showAddForm}
        onAddProfile={handleAddProfile}
        onCloseAddForm={closeAddForm}
        suggestedEmail={suggestedEmail}
        suggestedDisplayName={suggestedDisplayName}
        suggestedNotice={suggestedNotice}
        editingProfile={editingProfile}
        currentProfileId={currentProfile?.id}
        onEditSubmit={handleEditSubmit}
        onCloseEditForm={closeEditForm}
        showUninstallConfirm={showUninstallConfirm}
        uninstallInProgress={uninstallInProgress}
        onConfirmUninstall={handleConfirmUninstallProxyCertificate}
        onCloseUninstallConfirm={handleCloseUninstallConfirm}
        showCertInstallModal={showCertInstallModal}
        installGuide={installGuide}
        installGuideLoading={installGuideLoading}
        installInProgress={installInProgress}
        onCloseCertInstallModal={handleCloseCertInstallModal}
        onSaveProxyCertificate={handleSaveProxyCertificate}
        onInstallProxyCertificate={handleInstallProxyCertificate}
        storageProfile={storageProfile}
        runningInstances={runningInstances}
        storageProfileIsCurrent={storageProfile?.id === currentProfile?.id}
        storageInfo={storageInfo}
        storageLoading={storageLoading}
        cleanupInProgress={cleanupInProgress}
        lastCleanupResult={lastCleanupResult}
        onRequestStorageInfo={handleRequestStorageInfo}
        onCleanStorage={handleCleanStorage}
        onCloseStorageModal={handleCloseStorageModal}
        showPricesModal={showPricesModal}
        modelPricingData={modelPricingData}
        enabledModelPricingData={enabledModelPricingData}
        pricingLoading={pricingLoading}
        onClosePricesModal={handleClosePricesModal}
      />
    </div>
  );
};

export const App: React.FC = () => {
  const [locale, setLocale] = useState('en');
  const [messages, setMessages] = useState<Record<string, string>>({});

  return (
    <L10nProvider locale={locale} messages={messages}>
      <AppContent
        setLocale={setLocale}
        setMessages={setMessages}
        messages={messages}
      />
    </L10nProvider>
  );
};
