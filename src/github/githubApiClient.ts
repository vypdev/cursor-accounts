import type { GitHubRepoRef } from '@cursor-accounts/types';
import * as extensionLog from '../logging/extensionLog';
import {
  GITHUB_API_VERSION,
  GITHUB_USER_AGENT,
} from './githubConstants';

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

interface GitHubRepoResponse {
  private?: boolean;
}

interface GitHubCommitApi {
  sha: string;
  commit: {
    message: string;
    author?: { date?: string; name?: string };
  };
}

interface GitHubIssueApi {
  pull_request?: unknown;
}

export interface GitHubPublicMetadata {
  commits: Array<{
    sha: string;
    message: string;
    date: string;
    author?: string;
  }>;
  branchCount: number;
  openIssueCount: number;
  openPullRequestCount: number;
}

/**
 * HTTP client for GitHub REST API (anonymous and authenticated).
 */
export class GitHubApiClient {
  async probeVisibility(
    ref: GitHubRepoRef,
    token?: string
  ): Promise<{ status: number; private?: boolean }> {
    const response = await this.request(
      `${ref.apiBase}/repos/${ref.owner}/${ref.repo}`,
      token
    );
    if (response.status === 200) {
      const body = (await response.json()) as GitHubRepoResponse;
      return { status: 200, private: body.private };
    }
    return { status: response.status };
  }

  async fetchPublicMetadata(ref: GitHubRepoRef): Promise<GitHubPublicMetadata> {
    return this.fetchMetadata(ref, undefined);
  }

  async fetchAuthenticatedMetadata(
    ref: GitHubRepoRef,
    token: string
  ): Promise<GitHubPublicMetadata> {
    return this.fetchMetadata(ref, token);
  }

  private async fetchMetadata(
    ref: GitHubRepoRef,
    token: string | undefined
  ): Promise<GitHubPublicMetadata> {
    const base = `${ref.apiBase}/repos/${ref.owner}/${ref.repo}`;
    const [commits, branches, issues, pulls] = await Promise.all([
      this.fetchJson<GitHubCommitApi[]>(
        `${base}/commits?per_page=5`,
        token
      ),
      this.fetchJson<unknown[]>(`${base}/branches?per_page=30`, token),
      this.fetchJson<GitHubIssueApi[]>(
        `${base}/issues?state=open&per_page=20`,
        token
      ),
      this.fetchJson<unknown[]>(`${base}/pulls?state=open&per_page=20`, token),
    ]);

    return {
      commits: commits.map((c) => ({
        sha: c.sha.slice(0, 7),
        message: (c.commit.message.split('\n')[0] ?? '').slice(0, 120),
        date: c.commit.author?.date ?? '',
        author: c.commit.author?.name,
      })),
      branchCount: branches.length,
      openIssueCount: issues.filter((i) => !i.pull_request).length,
      openPullRequestCount: pulls.length,
    };
  }

  private async fetchJson<T>(url: string, token?: string): Promise<T> {
    const response = await this.request(url, token);
    if (!response.ok) {
      throw new GitHubApiError(
        `GitHub API ${response.status} for ${url}`,
        response.status
      );
    }
    return (await response.json()) as T;
  }

  private async request(
    url: string,
    token?: string
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': GITHUB_USER_AGENT,
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      return await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      extensionLog.debug(
        `[GitHubApiClient] Request failed: ${extensionLog.formatError(error)}`
      );
      throw error;
    }
  }
}
