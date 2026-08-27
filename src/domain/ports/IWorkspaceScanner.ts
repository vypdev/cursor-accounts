import type { WorkspaceInfo } from '@cursor-accounts/types';

/** Port for reading workspaces associated with a profile data directory. */
export interface IWorkspaceScanner {
  scanWorkspacesForProfile(userDataDir: string): Promise<WorkspaceInfo[]>;
}
