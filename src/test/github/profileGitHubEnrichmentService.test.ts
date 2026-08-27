import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  GitHubRepoRef,
  Profile,
  ProfileWithWorkspaces,
  WorkspaceInfo,
} from '@cursor-accounts/types';
import { ProfileGitHubEnrichmentService } from '../../github/profileGitHubEnrichmentService';
import type { GitRemoteResolver } from '../../github/gitRemoteResolver';
import type { GitHubApiClient } from '../../github/githubApiClient';
import type { GitHubRepoVisibilityService } from '../../github/githubRepoVisibilityService';
import type { ProfileGitHubTokenReader } from '../../github/profileGitHubTokenReader';

const BASE_PROFILE: Profile = {
  id: 'profile',
  email: 'user@example.com',
  slug: 'user',
  displayName: 'User',
  userDataDir: '/tmp/cursor-user',
  created: '2024-01-01T00:00:00.000Z',
};

function workspace(storageHash: string): WorkspaceInfo {
  return {
    path: `/tmp/${storageHash}`,
    name: storageHash,
    lastModified: '2024-01-01T00:00:00.000Z',
    storageHash,
  };
}

function ref(fullName: string): GitHubRepoRef {
  const [owner, repo] = fullName.split('/');
  return {
    owner: owner ?? '',
    repo: repo ?? '',
    apiBase: 'https://api.github.com',
    fullName,
  };
}

function createService(options: {
  remotes: Map<string, GitHubRepoRef>;
  anonymousVisibility: Map<string, string>;
  authenticatedVisibility?: Map<string, string>;
  token?: string;
  publicMetadataError?: boolean;
  authenticatedMetadataError?: boolean;
}) {
  const remoteResolver = {
    resolveFromWorkspacePath: async (workspacePath: string) => {
      if (workspacePath === '/tmp/throws') {
        throw new Error('remote failure');
      }
      return options.remotes.get(workspacePath) ?? null;
    },
  } as unknown as GitRemoteResolver;
  const visibilityService = {
    probeAnonymous: async (repository: GitHubRepoRef) =>
      options.anonymousVisibility.get(repository.fullName) ?? 'not_found',
    probeAuthenticated: async (repository: GitHubRepoRef) =>
      options.authenticatedVisibility?.get(repository.fullName) ?? 'not_found',
  } as unknown as GitHubRepoVisibilityService;
  const apiClient = {
    fetchPublicMetadata: async () => {
      if (options.publicMetadataError) {
        throw new Error('public metadata failure');
      }
      return {
        commits: [
          { sha: '1234567', message: 'Commit', date: '2024-01-01' },
        ],
        branchCount: 2,
        openIssueCount: 3,
        openPullRequestCount: 4,
      };
    },
    fetchAuthenticatedMetadata: async () => {
      if (options.authenticatedMetadataError) {
        throw new Error('authenticated metadata failure');
      }
      return {
        commits: [],
        branchCount: 5,
        openIssueCount: 6,
        openPullRequestCount: 7,
      };
    },
  } as unknown as GitHubApiClient;
  const tokenReader = {
    readToken: async () =>
      options.token
        ? { status: 'configured' as const, token: options.token }
        : { status: 'invalid' as const },
  } as unknown as ProfileGitHubTokenReader;

  return new ProfileGitHubEnrichmentService(
    remoteResolver,
    visibilityService,
    apiClient,
    tokenReader
  );
}

describe('ProfileGitHubEnrichmentService', () => {
  it('maps public, authenticated-private, private, rate-limited, and missing repositories', async () => {
    const publicRef = ref('owner/public');
    const privateRef = ref('owner/private');
    const hiddenRef = ref('owner/hidden');
    const limitedRef = ref('owner/limited');
    const missingRef = ref('owner/missing');
    const tokenProfile: ProfileWithWorkspaces = {
      ...BASE_PROFILE,
      id: 'token',
      githubTokenPath: '/tmp/github-token',
      workspaces: [workspace('private')],
    };
    const publicProfile: ProfileWithWorkspaces = {
      ...BASE_PROFILE,
      id: 'public',
      workspaces: [workspace('public')],
    };
    const hiddenProfile: ProfileWithWorkspaces = {
      ...BASE_PROFILE,
      id: 'hidden',
      workspaces: [workspace('hidden')],
    };
    const limitedProfile: ProfileWithWorkspaces = {
      ...BASE_PROFILE,
      id: 'limited',
      workspaces: [workspace('limited')],
    };
    const missingProfile: ProfileWithWorkspaces = {
      ...BASE_PROFILE,
      id: 'missing',
      workspaces: [workspace('missing')],
    };
    const service = createService({
      remotes: new Map([
        ['/tmp/public', publicRef],
        ['/tmp/private', privateRef],
        ['/tmp/hidden', hiddenRef],
        ['/tmp/limited', limitedRef],
        ['/tmp/missing', missingRef],
      ]),
      anonymousVisibility: new Map([
        ['owner/public', 'public'],
        ['owner/private', 'private'],
        ['owner/hidden', 'private'],
        ['owner/limited', 'rate_limited'],
        ['owner/missing', 'not_found'],
      ]),
      authenticatedVisibility: new Map([['owner/private', 'private']]),
      token: 'secret-token',
    });

    const result = await service.enrichProfiles([
      publicProfile,
      tokenProfile,
      hiddenProfile,
      limitedProfile,
      missingProfile,
    ]);

    assert.deepEqual(result.tokenStatus, {
      public: 'not_configured',
      token: 'configured',
      hidden: 'not_configured',
      limited: 'not_configured',
      missing: 'not_configured',
    });
    assert.deepEqual(result.summaries.public?.public, {
      storageHash: 'public',
      fullName: 'owner/public',
      visibility: 'public',
      commits: [
        { sha: '1234567', message: 'Commit', date: '2024-01-01' },
      ],
      branchCount: 2,
      openIssueCount: 3,
      openPullRequestCount: 4,
    });
    assert.deepEqual(result.summaries.token?.private, {
      storageHash: 'private',
      fullName: 'owner/private',
      visibility: 'private',
      commits: [],
      branchCount: 5,
      openIssueCount: 6,
      openPullRequestCount: 7,
    });
    assert.deepEqual(result.summaries.hidden?.hidden, {
      storageHash: 'hidden',
      fullName: 'owner/hidden',
      visibility: 'private',
    });
    assert.deepEqual(result.summaries.limited?.limited, {
      storageHash: 'limited',
      fullName: 'owner/limited',
      visibility: 'rate_limited',
      error: 'rate_limited',
    });
    assert.deepEqual(result.summaries.missing?.missing, {
      storageHash: 'missing',
      fullName: 'owner/missing',
      visibility: 'not_found',
    });
  });

  it('returns an error summary when metadata retrieval fails', async () => {
    const publicRepository = ref('owner/public');
    const authenticatedRepository = ref('owner/private');
    const service = createService({
      remotes: new Map([
        ['/tmp/public', publicRepository],
        ['/tmp/private', authenticatedRepository],
      ]),
      anonymousVisibility: new Map([
        ['owner/public', 'public'],
        ['owner/private', 'private'],
      ]),
      authenticatedVisibility: new Map([['owner/private', 'public']]),
      token: 'secret-token',
      publicMetadataError: true,
      authenticatedMetadataError: true,
    });

    const result = await service.enrichProfiles([
      { ...BASE_PROFILE, id: 'public', workspaces: [workspace('public')] },
      {
        ...BASE_PROFILE,
        id: 'private',
        githubTokenPath: '/tmp/github-token',
        workspaces: [workspace('private')],
      },
    ]);

    assert.equal(result.summaries.public?.public?.visibility, 'public');
    assert.match(
      result.summaries.public?.public?.error ?? '',
      /Error: public metadata failure/
    );
    assert.equal(result.summaries.private?.private?.visibility, 'public');
    assert.match(
      result.summaries.private?.private?.error ?? '',
      /Error: authenticated metadata failure/
    );
  });

  it('continues enriching later workspaces after a workspace failure', async () => {
    const repository = ref('owner/public');
    const service = createService({
      remotes: new Map([['/tmp/public', repository]]),
      anonymousVisibility: new Map([['owner/public', 'public']]),
      token: 'secret-token',
    });

    const result = await service.enrichProfiles([
      {
        ...BASE_PROFILE,
        id: 'mixed',
        githubTokenPath: '/tmp/github-token',
        workspaces: [workspace('throws'), workspace('public')],
      },
    ]);

    assert.deepEqual(Object.keys(result.summaries.mixed ?? {}), ['public']);
  });
});
