import type { Dispatch, SetStateAction } from 'react';
import type { AppMessageAction } from '../appMessageState';
import type { Profile } from '../types';
import {
  type AppProfileBridgeActions,
  useAppProfileBridgeActions,
} from './useAppProfileBridgeActions';
import {
  type AppProfileFormActions,
  useAppProfileFormActions,
} from './useAppProfileFormActions';

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

export interface AppProfileActions
  extends AppProfileBridgeActions,
    AppProfileFormActions {}

/** Composes profile bridge and form actions for the Accounts webview. */
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
  const bridgeActions = useAppProfileBridgeActions({ setShowImportDialog });
  const formActions = useAppProfileFormActions({
    profiles,
    loading,
    showAddForm,
    editingProfileId,
    setShowAddForm,
    setEditingProfileId,
    dispatchAppMessage,
  });

  return { ...bridgeActions, ...formActions };
}
