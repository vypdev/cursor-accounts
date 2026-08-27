import { useL10n } from '../l10n/context';
import type {
  GitHubRepoSummary,
  Profile,
  ProfileGithubTokenStatus,
  WorkspaceInfo,
} from '../types';
import { MAX_DISPLAY_WORKSPACES } from './profileCardPresentation';

interface ProfileCardWorkspacesProps {
  profile: Profile;
  workspaces: WorkspaceInfo[];
  repoSummaries: Record<string, GitHubRepoSummary>;
  githubTokenStatus: ProfileGithubTokenStatus;
  onOpenProject: (projectPath: string) => void;
  onConfigureGithubToken: () => void;
  onClearGithubToken: () => void;
}

function WorkspaceRepoMeta({
  summary,
  t,
}: {
  summary: GitHubRepoSummary;
  t: (key: string, args?: Record<string, string | number | undefined>) => string;
}) {
  if (summary.visibility === 'private') {
    return (
      <div className="workspace-repo-meta">
        {summary.fullName ? (
          <span className="repo-slug">{summary.fullName}</span>
        ) : null}
        <span className="repo-badge repo-badge-private">
          {t('profileCard.repoPrivate')}
        </span>
      </div>
    );
  }

  if (summary.visibility === 'rate_limited') {
    return (
      <p className="workspace-repo-hint">{t('profileCard.rateLimited')}</p>
    );
  }

  if (summary.visibility !== 'public') {
    return null;
  }

  const latest = summary.commits?.[0];
  return (
    <div className="workspace-repo-meta">
      {summary.fullName ? (
        <span className="repo-slug">{summary.fullName}</span>
      ) : null}
      <span className="repo-badge repo-badge-public">
        {t('profileCard.repoPublic')}
      </span>
      {summary.branchCount != null ? (
        <p className="workspace-repo-stats">
          {t('profileCard.repoMeta', {
            branches: summary.branchCount,
            issues: summary.openIssueCount ?? 0,
            pulls: summary.openPullRequestCount ?? 0,
          })}
        </p>
      ) : null}
      {latest ? (
        <p className="workspace-repo-commit" title={latest.message}>
          {t('profileCard.latestCommit', { message: latest.message })}
        </p>
      ) : null}
    </div>
  );
}

export function ProfileCardWorkspaces({
  profile,
  workspaces,
  repoSummaries,
  githubTokenStatus,
  onOpenProject,
  onConfigureGithubToken,
  onClearGithubToken,
}: ProfileCardWorkspacesProps) {
  const { t } = useL10n();
  const displayedWorkspaces = workspaces.slice(0, MAX_DISPLAY_WORKSPACES);

  if (displayedWorkspaces.length === 0) {
    return null;
  }

  return (
    <div className="profile-workspaces">
      <h4 className="profile-workspaces-title">
        {t('profileCard.recentProjects')}
      </h4>
      <ul className="workspace-list">
        {displayedWorkspaces.map((workspace) => {
          const isProjectOpen = Boolean(workspace.isOpenInSession);
          const summary = repoSummaries[workspace.storageHash];

          return (
            <li
              key={workspace.storageHash}
              className={`workspace-item${isProjectOpen ? ' is-open' : ''}`}
            >
              <div className="workspace-item-main">
                <span className="workspace-name" title={workspace.path}>
                  {workspace.name}
                </span>
                {summary ? <WorkspaceRepoMeta summary={summary} t={t} /> : null}
                {summary?.visibility === 'private' &&
                githubTokenStatus === 'not_configured' ? (
                  <p className="workspace-repo-hint">
                    {t('profileCard.privateRepoHint')}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className={`btn-open-project${isProjectOpen ? ' is-open' : ''}`}
                onClick={() => onOpenProject(workspace.path)}
                disabled={isProjectOpen}
              >
                {isProjectOpen
                  ? t('profileCard.projectAlreadyOpen')
                  : t('profileCard.openProject')}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="profile-github-token">
        {githubTokenStatus === 'configured' ? (
          <span className="github-token-status configured">
            {t('profileCard.githubTokenConfigured')}
          </span>
        ) : null}
        {githubTokenStatus === 'invalid' ? (
          <span className="github-token-status invalid">
            {t('profileCard.githubTokenInvalid')}
          </span>
        ) : null}
        <button
          type="button"
          className="btn-github-token"
          onClick={onConfigureGithubToken}
        >
          {t('profileCard.configureGithubToken')}
        </button>
        {profile.githubTokenPath ? (
          <button
            type="button"
            className="btn-github-token-clear"
            onClick={onClearGithubToken}
          >
            {t('profileCard.clearGithubToken')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
