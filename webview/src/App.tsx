import React, { useCallback, useEffect, useState } from 'react';
import { vscodeApi } from './api/vscodeApi';
import { AddProfileForm } from './components/AddProfileForm';
import { EditProfileForm } from './components/EditProfileForm';
import { EmptyState } from './components/EmptyState';
import { ImportDialog } from './components/ImportDialog';
import { ProfileList } from './components/ProfileList';
import {
  ImportOptions,
  Profile,
  ProfileAccountMap,
  ProfileAccountView,
  ProfileQuotaMap,
  InstanceInfoMap,
  ToWebviewMessage,
} from './types';
import './App.css';

export const App: React.FC = () => {
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
          setProfiles(message.data.profiles);
          setCurrentProfile(message.data.currentProfile);
          setQuotas(message.data.quotas ?? {});
          setProfileAccounts(message.data.profileAccounts ?? {});
          setActiveAccount(message.data.activeAccount ?? null);
          setRunningInstances(message.data.runningInstances ?? {});
          setLoading(false);
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
      }
    });

    vscodeApi.ready();

    return unsubscribe;
  }, []);

  const handleLaunch = useCallback((profileId: string) => {
    vscodeApi.launch(profileId);
  }, []);

  const handleEditOpen = useCallback(
    (profileId: string) => {
      setEditingProfileId(profileId);
      persistUiState(showAddForm, profileId);
    },
    [showAddForm, persistUiState]
  );

  const handleEditSubmit = useCallback(
    (profileId: string, updates: Partial<Profile>) => {
      vscodeApi.editProfile(profileId, updates);
      setEditingProfileId(null);
      persistUiState(showAddForm, null);
    },
    [showAddForm, persistUiState]
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

  const editingProfile = editingProfileId
    ? profiles.find((p) => p.id === editingProfileId)
    : undefined;

  const activeAccountLabel = (() => {
    if (accountsLoading && !activeAccount?.accountName) {
      return 'Loading account…';
    }
    if (activeAccount?.accountName) {
      return activeAccount.accountName;
    }
    if (currentProfile) {
      return currentProfile.displayName;
    }
    return 'Default Profile';
  })();

  const showActiveFooter =
    accountsLoading || activeAccount != null || currentProfile != null;

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" aria-hidden="true" />
        <p>Loading profiles...</p>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="app-main">
        <div className="header">
          <h2>Cursor Accounts</h2>
          <div className="header-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowImportDialog(true)}
              title="Import profiles"
            >
              Import
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => vscodeApi.refresh()}
              title="Refresh profiles"
            >
              ↻
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={openAddForm}
              title="Add new profile"
            >
              + Add
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

        {profiles.length === 0 ? (
          <EmptyState onAddProfile={openAddForm} />
        ) : (
          <ProfileList
            profiles={profiles}
            currentProfileId={currentProfile?.id}
            profileAccounts={profileAccounts}
            quotas={quotas}
            runningInstances={runningInstances}
            onLaunch={handleLaunch}
            onEdit={handleEditOpen}
            onDelete={handleDelete}
            onShowInExplorer={handleShowInExplorer}
            onExport={handleExport}
          />
        )}
      </div>

      {showActiveFooter && (
        <button
          type="button"
          className="active-account-footer"
          disabled
          aria-label="Active account"
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
          onSubmit={(updates) => handleEditSubmit(editingProfile.id, updates)}
          onCancel={closeEditForm}
        />
      )}
    </div>
  );
};
