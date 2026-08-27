import type {
  InstanceInfoMap,
  Profile,
  ProfileWithWorkspaces,
  WorkspaceInfo,
} from '@cursor-accounts/types';
import { getOpenProjectPathsForProfile } from '../../profiles/instanceDetector';
import { isWorkspacePathOpen } from '../../services/activeWorkspaceService';

/** Build the webview workspace projection without performing I/O. */
export function buildProfileWorkspaceMap(
  profilesWithWorkspaces: ProfileWithWorkspaces[],
  currentProfile: Profile | null,
  openPaths: string[],
  runningInstances: InstanceInfoMap
): Record<string, WorkspaceInfo[]> {
  const profileWorkspaces: Record<string, WorkspaceInfo[]> = {};

  for (const profile of profilesWithWorkspaces) {
    const openProjectPaths = getOpenProjectPathsForProfile(
      runningInstances,
      profile.id
    );

    profileWorkspaces[profile.id] = profile.workspaces.map((workspace) => ({
      ...workspace,
      isOpenInSession:
        (currentProfile?.id === profile.id &&
          isWorkspacePathOpen(workspace.path, openPaths)) ||
        openProjectPaths.some((openPath) =>
          isWorkspacePathOpen(workspace.path, [openPath])
        ),
    }));
  }

  return profileWorkspaces;
}
