import type { GitHubRepoRef, RepoVisibility } from '@cursor-accounts/types';
import { GitHubApiClient } from './githubApiClient';
import { VISIBILITY_CACHE_MS } from './githubConstants';

interface VisibilityCacheEntry {
  visibility: RepoVisibility;
  expiresAt: number;
}

/**
 * Classifies GitHub repo visibility via a single probe request (cached).
 */
export class GitHubRepoVisibilityService {
  private readonly cache = new Map<string, VisibilityCacheEntry>();

  constructor(private readonly apiClient = new GitHubApiClient()) {}

  async probeAnonymous(ref: GitHubRepoRef): Promise<RepoVisibility> {
    return this.probe(ref, undefined);
  }

  async probeAuthenticated(
    ref: GitHubRepoRef,
    token: string
  ): Promise<RepoVisibility> {
    return this.probe(ref, token);
  }

  private async probe(
    ref: GitHubRepoRef,
    token: string | undefined
  ): Promise<RepoVisibility> {
    const cacheKey = `${token ? 'auth' : 'anon'}:${ref.fullName}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.visibility;
    }

    const visibility = await this.probeUncached(ref, token);
    this.cache.set(cacheKey, {
      visibility,
      expiresAt: Date.now() + VISIBILITY_CACHE_MS,
    });
    return visibility;
  }

  private async probeUncached(
    ref: GitHubRepoRef,
    token: string | undefined
  ): Promise<RepoVisibility> {
    try {
      const result = await this.apiClient.probeVisibility(ref, token);
      if (result.status === 200) {
        return result.private ? 'private' : 'public';
      }
      if (result.status === 404) {
        return token ? 'not_found' : 'private';
      }
      if (result.status === 403) {
        return 'rate_limited';
      }
      return 'not_found';
    } catch {
      return 'not_found';
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}
