/** Parsed GitHub repository reference from a local git remote. */
export interface GitHubRepoRef {
  owner: string;
  repo: string;
  /** API base URL, e.g. https://api.github.com */
  apiBase: string;
  /** Display slug owner/repo */
  fullName: string;
}

export type RepoVisibility = 'public' | 'private' | 'not_found' | 'rate_limited';

/** Latest commit summary for webview display. */
export interface GitHubCommitSummary {
  sha: string;
  message: string;
  date: string;
  author?: string;
}

/** Repository metadata shown on a workspace row. */
export interface GitHubRepoSummary {
  storageHash: string;
  fullName?: string;
  visibility: RepoVisibility;
  commits?: GitHubCommitSummary[];
  branchCount?: number;
  openIssueCount?: number;
  openPullRequestCount?: number;
  error?: string;
}

export type ProfileGithubTokenStatus =
  | 'not_configured'
  | 'configured'
  | 'invalid';

/** GitHub enrichment keyed by workspace storageHash per profile. */
export type ProfileRepoSummariesMap = Record<string, GitHubRepoSummary>;

export type ProfileGithubSummariesMap = Record<
  string,
  ProfileRepoSummariesMap
>;

export type ProfileGithubTokenStatusMap = Record<
  string,
  ProfileGithubTokenStatus
>;
