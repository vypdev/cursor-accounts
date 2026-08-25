import type { ProfileWithWorkspaces, WorkspaceInfo } from '@cursor-accounts/types';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { WorkspaceScanner } from '../profiles/workspaceScanner';

/**
 * Combines saved profiles with workspace folders scanned from each profile's data dir.
 */
export class ProfileWorkspaceService {
  constructor(
    private readonly profileManager: IProfileReader,
    private readonly workspaceScanner: WorkspaceScanner
  ) {}

  async getProfilesWithWorkspaces(): Promise<ProfileWithWorkspaces[]> {
    const profiles = await this.profileManager.getProfiles();
    return Promise.all(
      profiles.map(async (profile) => ({
        ...profile,
        workspaces: await this.workspaceScanner.scanWorkspacesForProfile(
          profile.userDataDir
        ),
      }))
    );
  }

  async getWorkspacesForProfile(profileId: string): Promise<WorkspaceInfo[]> {
    const profile = await this.profileManager.getProfile(profileId);
    if (!profile) {
      return [];
    }

    return this.workspaceScanner.scanWorkspacesForProfile(profile.userDataDir);
  }

  async getMostRecentWorkspace(profileId: string): Promise<string | undefined> {
    const workspaces = await this.getWorkspacesForProfile(profileId);
    return workspaces[0]?.path;
  }
}
