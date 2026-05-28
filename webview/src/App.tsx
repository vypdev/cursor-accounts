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
  const [runningInstances, setRunningInstances] = useState<InstanceInfoMap>({});
  const [showAddForm, setShowAddForm] = useState(
    persisted?.showAddForm ?? false
  );
  const [showImportDialog, setShowImportDialog] = useState(false);
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
          setRunningInstances(message.data.runningInstances ?? {});
          setLoading(false);
          break;

        case 'profiles':
          setProfiles(message.data);
          break;

        case 'quotas':
          setQuotas(message.data);
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
      color?: string
    ) => {
      vscodeApi.addProfile(email, displayName, theme, color);
      setShowAddForm(false);
      persistUiState(false, editingProfileId);
    },
    [editingProfileId, persistUiState]
  );

  const openAddForm = useCallback(() => {
    setShowAddForm(true);
    persistUiState(true, editingProfileId);
  }, [editingProfileId, persistUiState]);

  const closeAddForm = useCallback(() => {
    setShowAddForm(false);
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

      {currentProfile && (
        <div className="current-profile">
          <span className="label">Current:</span>
          <span className="profile-name">{currentProfile.displayName}</span>
        </div>
      )}

      {profiles.length === 0 ? (
        <EmptyState onAddProfile={openAddForm} />
      ) : (
        <ProfileList
          profiles={profiles}
          currentProfileId={currentProfile?.id}
          quotas={quotas}
          runningInstances={runningInstances}
          onLaunch={handleLaunch}
          onEdit={handleEditOpen}
          onDelete={handleDelete}
          onShowInExplorer={handleShowInExplorer}
          onExport={handleExport}
        />
      )}

      {showImportDialog && (
        <ImportDialog
          onImport={handleImport}
          onCancel={() => setShowImportDialog(false)}
        />
      )}

      {showAddForm && (
        <AddProfileForm onSubmit={handleAddProfile} onCancel={closeAddForm} />
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
