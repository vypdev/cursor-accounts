import type {
  GitHubRepoSummary,
  Profile,
  ProfileGithubSummariesMap,
  ProfileGithubTokenStatusMap,
  ProfileWithWorkspaces,
  RepoVisibility,
  WorkspaceInfo,
} from '@cursor-accounts/types';
import * as extensionLog from '../logging/extensionLog';
import { GitRemoteResolver } from './gitRemoteResolver';
import { GitHubApiClient } from './githubApiClient';
import { GitHubRepoVisibilityService } from './githubRepoVisibilityService';
import { MAX_REPOS_PER_PROFILE } from './githubConstants';
import { ProfileGitHubTokenReader } from './profileGitHubTokenReader';

export interface GitHubEnrichmentResult {
  summaries: ProfileGithubSummariesMap;
  tokenStatus: ProfileGithubTokenStatusMap;
}

/**
 * Enriches recent workspaces with GitHub metadata (public-first, optional token).
 */
export class ProfileGitHubEnrichmentService {
  constructor(
    private readonly remoteResolver = new GitRemoteResolver(),
    private readonly visibilityService = new GitHubRepoVisibilityService(),
    private readonly apiClient = new GitHubApiClient(),
    private readonly tokenReader = new ProfileGitHubTokenReader()
  ) {}

  async enrichProfiles(
    profilesWithWorkspaces: ProfileWithWorkspaces[]
  ): Promise<GitHubEnrichmentResult> {
    const summaries: ProfileGithubSummariesMap = {};
    const tokenStatus: ProfileGithubTokenStatusMap = {};

    for (const profile of profilesWithWorkspaces) {
      const tokenResult = await this.tokenReader.readToken(profile);
      const hasPath = Boolean(profile.githubTokenPath?.trim());
      tokenStatus[profile.id] = !hasPath
        ? 'not_configured'
        : tokenResult.token
          ? 'configured'
          : 'invalid';

      summaries[profile.id] = await this.enrichProfileWorkspaces(
        profile,
        profile.workspaces.slice(0, MAX_REPOS_PER_PROFILE),
        tokenResult.token
      );
    }

    return { summaries, tokenStatus };
  }

  private async enrichProfileWorkspaces(
    profile: Profile,
    workspaces: WorkspaceInfo[],
    token: string | undefined
  ): Promise<Record<string, GitHubRepoSummary>> {
    const result: Record<string, GitHubRepoSummary> = {};

    for (const workspace of workspaces) {
      try {
        const summary = await this.enrichWorkspace(workspace, token);
        if (summary) {
          result[workspace.storageHash] = summary;
        }
      } catch (error) {
        extensionLog.debug(
          `[ProfileGitHubEnrichment] ${profile.id} ${workspace.path}: ${extensionLog.formatError(error)}`
        );
      }
    }

    return result;
  }

  private async enrichWorkspace(
    workspace: WorkspaceInfo,
    token: string | undefined
  ): Promise<GitHubRepoSummary | null> {
    const ref = await this.remoteResolver.resolveFromWorkspacePath(
      workspace.path
    );
    if (!ref) {
      return null;
    }

    const anonymousVisibility =
      await this.visibilityService.probeAnonymous(ref);

    if (anonymousVisibility === 'public') {
      return this.buildPublicSummary(workspace.storageHash, ref);
    }

    if (anonymousVisibility === 'private' && token) {
      const authVisibility = await this.visibilityService.probeAuthenticated(
        ref,
        token
      );
      if (authVisibility === 'public' || authVisibility === 'private') {
        return this.buildAuthenticatedSummary(
          workspace.storageHash,
          ref,
          token,
          authVisibility
        );
      }
    }

    if (anonymousVisibility === 'private') {
      return {
        storageHash: workspace.storageHash,
        fullName: ref.fullName,
        visibility: 'private',
      };
    }

    if (anonymousVisibility === 'rate_limited') {
      return {
        storageHash: workspace.storageHash,
        fullName: ref.fullName,
        visibility: 'rate_limited',
        error: 'rate_limited',
      };
    }

    return {
      storageHash: workspace.storageHash,
      fullName: ref.fullName,
      visibility: 'not_found',
    };
  }

  private async buildPublicSummary(
    storageHash: string,
    ref: { fullName: string; owner: string; repo: string; apiBase: string }
  ): Promise<GitHubRepoSummary> {
    try {
      const metadata = await this.apiClient.fetchPublicMetadata(ref);
      return {
        storageHash,
        fullName: ref.fullName,
        visibility: 'public',
        commits: metadata.commits,
        branchCount: metadata.branchCount,
        openIssueCount: metadata.openIssueCount,
        openPullRequestCount: metadata.openPullRequestCount,
      };
    } catch (error) {
      return {
        storageHash,
        fullName: ref.fullName,
        visibility: 'public',
        error: extensionLog.formatError(error),
      };
    }
  }

  private async buildAuthenticatedSummary(
    storageHash: string,
    ref: { fullName: string; owner: string; repo: string; apiBase: string },
    token: string,
    visibility: RepoVisibility
  ): Promise<GitHubRepoSummary> {
    try {
      const metadata = await this.apiClient.fetchAuthenticatedMetadata(
        ref,
        token
      );
      return {
        storageHash,
        fullName: ref.fullName,
        visibility,
        commits: metadata.commits,
        branchCount: metadata.branchCount,
        openIssueCount: metadata.openIssueCount,
        openPullRequestCount: metadata.openPullRequestCount,
      };
    } catch (error) {
      return {
        storageHash,
        fullName: ref.fullName,
        visibility,
        error: extensionLog.formatError(error),
      };
    }
  }
}
