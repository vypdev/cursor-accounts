import type {
  ProfileWithWorkspaces,
  WorkspaceInfo,
} from '@cursor-accounts/types';
import type { IProfileReader } from '../../domain/ports/IProfileReader';
import type { IWorkspaceScanner } from '../../domain/ports/IWorkspaceScanner';

/** Combines saved profiles with workspaces exposed by the workspace port. */
export class ProfileWorkspaceService {
  constructor(
    private readonly profileReader: IProfileReader,
    private readonly workspaceScanner: IWorkspaceScanner
  ) {}

  async getProfilesWithWorkspaces(): Promise<ProfileWithWorkspaces[]> {
    const profiles = await this.profileReader.getProfiles();
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
    const profile = await this.profileReader.getProfile(profileId);
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
