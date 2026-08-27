import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { vscodeApi } from '../api/vscodeApi';
import type { AppMessageAction } from '../appMessageState';
import type { Profile } from '../types';

interface UseAppProfileFormActionsOptions {
  profiles: Profile[];
  loading: boolean;
  showAddForm: boolean;
  editingProfileId: string | null;
  setShowAddForm: Dispatch<SetStateAction<boolean>>;
  setEditingProfileId: Dispatch<SetStateAction<string | null>>;
  dispatchAppMessage: Dispatch<AppMessageAction>;
}

export interface AppProfileFormActions {
  handleEditOpen: (profileId: string) => void;
  handleEditSubmit: (profileId: string, updates: Partial<Profile>) => void;
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
}

function persistUiState(showAddForm: boolean, editingProfileId: string | null) {
  vscodeApi.saveState({ showAddForm, editingProfileId });
}

/** Encapsulates profile form state transitions and their host messages. */
export function useAppProfileFormActions({
  profiles,
  loading,
  showAddForm,
  editingProfileId,
  setShowAddForm,
  setEditingProfileId,
  dispatchAppMessage,
}: UseAppProfileFormActionsOptions): AppProfileFormActions {
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

  return {
    handleEditOpen,
    handleEditSubmit,
    handleAddProfile,
    openAddForm,
    closeAddForm,
    closeEditForm,
  };
}
