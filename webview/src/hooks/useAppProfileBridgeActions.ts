import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { vscodeApi } from '../api/vscodeApi';
import type { ImportOptions } from '../types';

export interface AppProfileBridgeActions {
  handleLaunch: (profileId: string) => void;
  handleOpenProject: (profileId: string, projectPath: string) => void;
  handleDelete: (profileId: string) => void;
  handleShowInExplorer: (profileId: string) => void;
  handleExport: (profileIds: string[], includeSettings: boolean) => void;
  handleImport: (json: string, options: ImportOptions) => void;
  handleConfigureGithubToken: (profileId: string) => void;
  handleClearGithubToken: (profileId: string) => void;
}

interface UseAppProfileBridgeActionsOptions {
  setShowImportDialog: Dispatch<SetStateAction<boolean>>;
}

/** Encapsulates profile actions that only bridge user intent to the host. */
export function useAppProfileBridgeActions({
  setShowImportDialog,
}: UseAppProfileBridgeActionsOptions): AppProfileBridgeActions {
  const handleLaunch = useCallback((profileId: string) => {
    vscodeApi.launch(profileId);
  }, []);

  const handleOpenProject = useCallback(
    (profileId: string, projectPath: string) => {
      vscodeApi.launch(profileId, projectPath);
    },
    []
  );

  const handleDelete = useCallback((profileId: string) => {
    vscodeApi.deleteProfile(profileId);
  }, []);

  const handleShowInExplorer = useCallback((profileId: string) => {
    vscodeApi.showInExplorer(profileId);
  }, []);

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
    handleDelete,
    handleShowInExplorer,
    handleExport,
    handleImport,
    handleConfigureGithubToken,
    handleClearGithubToken,
  };
}
