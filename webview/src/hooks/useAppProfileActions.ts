import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { vscodeApi } from '../api/vscodeApi';
import type { AppMessageAction } from '../appMessageState';
import type { ImportOptions, Profile } from '../types';

interface UseAppProfileActionsOptions {
  profiles: Profile[];
  loading: boolean;
  showAddForm: boolean;
  editingProfileId: string | null;
  setShowAddForm: Dispatch<SetStateAction<boolean>>;
  setShowImportDialog: Dispatch<SetStateAction<boolean>>;
  setEditingProfileId: Dispatch<SetStateAction<string | null>>;
  dispatchAppMessage: Dispatch<AppMessageAction>;
}

export interface AppProfileActions {
  handleLaunch: (profileId: string) => void;
  handleOpenProject: (profileId: string, projectPath: string) => void;
  handleEditOpen: (profileId: string) => void;
  handleEditSubmit: (profileId: string, updates: Partial<Profile>) => void;
  handleDelete: (profileId: string) => void;
  handleShowInExplorer: (profileId: string) => void;
  handleAddProfile: (
    email: string,
    displayName?: string,
    theme?: string,
    color?: string,
    emoji?: string
  ) => void;
  openAddForm: () => void;
  closeAddForm: () => void;
  closeEditForm: () => void;
  handleExport: (profileIds: string[], includeSettings: boolean) => void;
  handleImport: (json: string, options: ImportOptions) => void;
  handleConfigureGithubToken: (profileId: string) => void;
  handleClearGithubToken: (profileId: string) => void;
}

function persistUiState(showAddForm: boolean, editingProfileId: string | null) {
  vscodeApi.saveState({ showAddForm, editingProfileId });
}

/** Composes profile-related presentation actions for the Accounts webview. */
export function useAppProfileActions({
  profiles,
  loading,
  showAddForm,
  editingProfileId,
  setShowAddForm,
  setShowImportDialog,
  setEditingProfileId,
  dispatchAppMessage,
}: UseAppProfileActionsOptions): AppProfileActions {
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
    [setEditingProfileId, showAddForm]
  );

  const handleEditSubmit = useCallback(
    (profileId: string, updates: Partial<Profile>) => {
      const profile = profiles.find((candidate) => candidate.id === profileId);

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
    [profiles, setEditingProfileId, showAddForm]
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
    [editingProfileId, setShowAddForm]
  );

  const openAddForm = useCallback(() => {
    setShowAddForm(true);

    if (!loading) {
      vscodeApi.requestSuggestedProfile();
      window.setTimeout(() => {
        dispatchAppMessage({ type: 'clearSuggestedProfile' });
      }, 2000);
    }

    persistUiState(true, editingProfileId);
  }, [dispatchAppMessage, editingProfileId, loading, setShowAddForm]);

  const closeAddForm = useCallback(() => {
    setShowAddForm(false);
    dispatchAppMessage({ type: 'clearSuggestedProfile' });
    persistUiState(false, editingProfileId);
  }, [dispatchAppMessage, editingProfileId, setShowAddForm]);

  const closeEditForm = useCallback(() => {
    setEditingProfileId(null);
    persistUiState(showAddForm, null);
  }, [setEditingProfileId, showAddForm]);

  const handleExport = useCallback(
    (profileIds: string[], includeSettings: boolean) => {
      vscodeApi.exportProfiles(profileIds, includeSettings);
    },
    []
  );

  const handleImport = useCallback(
    (json: string, options: ImportOptions) => {
      vscodeApi.importProfiles(json, options);
      setShowImportDialog(false);
    },
    [setShowImportDialog]
  );

  const handleConfigureGithubToken = useCallback((profileId: string) => {
    vscodeApi.configureGithubToken(profileId);
  }, []);

  const handleClearGithubToken = useCallback((profileId: string) => {
    vscodeApi.clearGithubToken(profileId);
  }, []);

  return {
    handleLaunch,
    handleOpenProject,
    handleEditOpen,
    handleEditSubmit,
    handleDelete,
    handleShowInExplorer,
    handleAddProfile,
    openAddForm,
    closeAddForm,
    closeEditForm,
    handleExport,
    handleImport,
    handleConfigureGithubToken,
    handleClearGithubToken,
  };
}
