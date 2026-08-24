import React, { useEffect, useRef, useState } from 'react';
import { useL10n } from '../l10n/context';
import type {
  EfficiencyStats,
  GitHubRepoSummary,
  Profile,
  ProfileAccountView,
  ProfileGithubTokenStatus,
  ProfileQuota,
  QuotaStatus,
  WorkspaceInfo,
} from '../types';
import {
  getEffectiveUsagePercent,
  getEfficiencyFillStatus,
  getEfficiencyPercentage,
  getPersonalModeAveragePercent,
  getQuotaStatus,
  formatEnterpriseUsageLabel,
  formatMonthlySpendLabel,
  formatTeamBudgetLabel,
  formatCompactNumber,
  getPersonalIncludedOverageCents,
  hasDistinctTeamBudget,
  isEnterpriseUsage
} from '../types';
import { formatMembershipType } from '../utils/formatters';

interface ProfileCardProps {
  profile: Profile;
  isCurrent: boolean;
  hasOpenWorkspaceInSession: boolean;
  account?: ProfileAccountView;
  workspaces?: WorkspaceInfo[];
  repoSummaries?: Record<string, GitHubRepoSummary>;
  githubTokenStatus?: ProfileGithubTokenStatus;
  quota?: ProfileQuota;
  isRunning: boolean;
  proxyTemporary?: boolean;
  onLaunch: (id: string) => void;
  onOpenProject: (profileId: string, projectPath: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onShowInExplorer: (id: string) => void;
  onManageStorage: (id: string) => void;
  onConfigureGithubToken: (id: string) => void;
  onClearGithubToken: (id: string) => void;
  efficiencyStats?: EfficiencyStats;
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

  if (summary.visibility === 'public') {
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

  return null;
}

function formatResetDate(
  isoString: string,
  t: (key: string, args?: Record<string, string | number | undefined>) => string
): string {
  if (!isoString) {
    return t('profileCard.unknownDate');
  }

  const numeric = Number(isoString);
  const date = Number.isFinite(numeric)
    ? new Date(numeric)
    : new Date(isoString);

  if (Number.isNaN(date.getTime())) {
    return t('profileCard.unknownDate');
  }

  const now = new Date();
  const days = Math.ceil(
    (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (days <= 0) {
    return t('profileCard.today');
  }
  if (days === 1) {
    return t('profileCard.tomorrow');
  }
  return t('profileCard.daysUntilReset', { days });
}

function isAuthError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes('authentication') ||
    lower.includes('token') ||
    lower.includes('sign in') ||
    lower.includes('expired')
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    const only = parts[0] ?? '?';
    return only.charAt(0).toUpperCase();
  }
  const first = parts[0] ?? '?';
  const last = parts[parts.length - 1] ?? first;
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

interface QuotaBarRowProps {
  percent: number;
  label?: string;
  fillStatus?: QuotaStatus;
}

function QuotaBarRow({ percent, label, fillStatus = 'ok' }: QuotaBarRowProps) {
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <div className={label ? 'quota-bar-row' : undefined}>
      {label ? <span className="quota-bar-label">{label}</span> : null}
      <div className="quota-bar" aria-hidden="true">
        <div
          className={`quota-fill ${fillStatus}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function formatDollarAmount(cents: number): string {
  if (!Number.isFinite(cents)) {
    return '0.00';
  }
  return (cents / 100).toFixed(2);
}

function formatRemainingLabel(
  quota: NonNullable<ProfileQuota['quota']>,
  t: (key: string, args?: Record<string, string | number | undefined>) => string
): string {
  const remaining = formatDollarAmount(quota.remaining);
  const includedOverage = getPersonalIncludedOverageCents(quota);
  if (includedOverage > 0) {
    return t('profileCard.remainingWithIncluded', {
      amount: remaining,
      included: formatDollarAmount(includedOverage),
    });
  }
  return t('profileCard.remaining', { amount: remaining });
}

function renderQuotaStatusIcons(
  quotaStatus: QuotaStatus,
  t: (key: string) => string
) {
  return (
    <>
      {quotaStatus === 'warning' && (
        <span className="warning-icon" aria-label={t('profileCard.warning')}>
          ⚠️
        </span>
      )}
      {quotaStatus === 'critical' && (
        <span className="error-icon" aria-label={t('profileCard.critical')}>
          🔴
        </span>
      )}
    </>
  );
}

const MAX_DISPLAY_WORKSPACES = 10;

function getRepositoryName(
  repoPath: string,
  workspaces?: WorkspaceInfo[]
): string {
  const workspace = workspaces?.find((item) => item.path === repoPath);
  if (workspace) {
    return workspace.name;
  }
  const normalized = repoPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? repoPath;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({
  profile,
  isCurrent,
  hasOpenWorkspaceInSession,
  account,
  workspaces = [],
  repoSummaries = {},
  githubTokenStatus = 'not_configured',
  quota,
  isRunning,
  proxyTemporary = false,
  onLaunch,
  onOpenProject,
  onEdit,
  onDelete,
  onShowInExplorer,
  onManageStorage,
  onConfigureGithubToken,
  onClearGithubToken,
  efficiencyStats,
}) => {
  const { t } = useL10n();
  const [showMenu, setShowMenu] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [leaderboardExpanded, setLeaderboardExpanded] = useState(false);
  const [quotaExpanded, setQuotaExpanded] = useState(false);
  const [efficiencyRepoExpanded, setEfficiencyRepoExpanded] = useState(false);
  const [expandedBranchRepos, setExpandedBranchRepos] = useState<Set<string>>(
    () => new Set()
  );
  const menuRef = useRef<HTMLDivElement>(null);

  const quotaStatus = quota?.quota
    ? getQuotaStatus(quota.quota)
    : 'unavailable';

  const usagePercent = quota?.quota
    ? getEffectiveUsagePercent(quota.quota)
    : 0;

  const isMonthlySpend = quota?.quota?.displayMode === 'monthlySpend';
  const isEnterprise = isEnterpriseUsage(quota?.quota);
  const isPersonalPercent = Boolean(quota?.quota && !isEnterprise && !isMonthlySpend);
  const averagePercent = quota?.quota ? getPersonalModeAveragePercent(quota.quota) : 0;

  const leaderboardEntries = quota?.activityLeaderboard?.entries ?? [];
  const isInTopActivity = leaderboardEntries.some(
    (entry) => entry.email.toLowerCase() === profile.email.toLowerCase()
  );
  const leaderboardStatusMessage = isInTopActivity
    ? t('profileCard.topActivity')
    : t('profileCard.notTopActivity');

  const accountName = account?.accountName ?? profile.email;
  const showAvatar = account?.pictureUrl && !avatarError;
  const membershipLabel = formatMembershipType(quota?.quota?.membershipType);

  useEffect(() => {
    setAvatarError(false);
  }, [account?.pictureUrl]);

  useEffect(() => {
    setLeaderboardExpanded(false);
    setQuotaExpanded(false);
    setEfficiencyRepoExpanded(false);
    setExpandedBranchRepos(new Set());
  }, [profile.id]);

  useEffect(() => {
    if (!showMenu) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const handleLaunch = () => {
    onLaunch(profile.id);
  };

  const handleOpenProject = (projectPath: string) => {
    onOpenProject(profile.id, projectPath);
  };

  const toggleBranchExpanded = (repoPath: string) => {
    setExpandedBranchRepos((previous) => {
      const next = new Set(previous);
      if (next.has(repoPath)) {
        next.delete(repoPath);
      } else {
        next.add(repoPath);
      }
      return next;
    });
  };

  const displayedWorkspaces = workspaces.slice(0, MAX_DISPLAY_WORKSPACES);

  const handleDelete = () => {
    if (confirm(t('profileCard.deleteConfirm', { name: profile.displayName }))) {
      onDelete(profile.id);
      setShowMenu(false);
    }
  };

  const borderColor = profile.color ?? 'var(--vscode-button-background)';

  return (
    <div
      className={`profile-card ${isCurrent ? 'current' : ''} ${isRunning ? 'running' : ''} quota-${quotaStatus}`}
      style={{ borderLeftColor: borderColor }}
      role="listitem"
    >
      <div className="profile-header">
        <div className="profile-info">
          {isRunning && (
            <span className="running-indicator" title={t('profileCard.running')}>
              ●
            </span>
          )}
          {proxyTemporary && (
            <span
              className="profile-proxy-temporary-badge"
              title={t('profileCard.proxyTemporaryHint')}
            >
              {t('profileCard.proxyTemporary')}
            </span>
          )}
          <div className="profile-identity">
            <div className="profile-avatar-wrap">
              {showAvatar ? (
                <img
                  className="profile-avatar"
                  src={account.pictureUrl}
                  alt=""
                  onError={() => setAvatarError(true)}
                />
              ) : (
                <span className="profile-avatar profile-avatar-fallback" aria-hidden="true">
                  {getInitials(accountName)}
                </span>
              )}
              {profile.emoji && (
                <span className="profile-emoji-badge" aria-hidden="true">
                  {profile.emoji}
                </span>
              )}
            </div>
            <div className="profile-text">
              <h3>{accountName}</h3>
              <div className="profile-email-row">
                <span className="email">{profile.email}</span>
                {membershipLabel && (
                  <span className="account-type-badge" title={t('profileCard.accountType')}>
                    {membershipLabel}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        {isCurrent && <span className="badge">{t('profileCard.active')}</span>}
      </div>

      {isCurrent && !hasOpenWorkspaceInSession ? (
        <p className="profile-no-project-open">{t('profileCard.noProjectOpen')}</p>
      ) : null}

      {profile.theme && (
        <div className="profile-meta">
          <span className="theme">{t('profileCard.theme', { theme: profile.theme })}</span>
        </div>
      )}

      {profile.lastLaunched && (
        <div className="profile-meta">
          <span className="last-launched">
            {t('profileCard.lastLaunched', {
              date: new Date(profile.lastLaunched).toLocaleDateString(),
            })}
          </span>
        </div>
      )}

      {quota && (
        <div className="quota-section">
          {quota.error ? (
            isAuthError(quota.error) ? (
              <div className="quota-auth-required">
                <span className="icon" aria-hidden="true">
                  🔒
                </span>
                <span>{quota.error}</span>
                <button type="button" onClick={handleLaunch}>
                  {t('profileCard.signIn')}
                </button>
              </div>
            ) : (
              <div className="quota-error" role="alert">
                <span className="icon" aria-hidden="true">
                  ⚠️
                </span>
                <span>{quota.error}</span>
              </div>
            )
          ) : quota.quota ? (
            isPersonalPercent ? (
              <>
                <button
                  type="button"
                  className="quota-toggle"
                  onClick={() => setQuotaExpanded((expanded) => !expanded)}
                  aria-expanded={quotaExpanded}
                >
                  <div className="quota-toggle-main">
                    <QuotaBarRow percent={averagePercent} fillStatus={quotaStatus} />
                    <div className="quota-text">
                      <span className="percent">{averagePercent}%</span>
                      <span className="label">{t('profileCard.used')}</span>
                      {renderQuotaStatusIcons(quotaStatus, t)}
                    </div>
                  </div>
                  <span className="quota-chevron" aria-hidden="true">
                    {quotaExpanded ? '▾' : '▸'}
                  </span>
                </button>
                {quotaExpanded && (
                  <div className="quota-bars-expanded">
                    <QuotaBarRow
                      percent={quota.quota.autoPercentUsed}
                      label={t('profileCard.autoMode')}
                    />
                    <QuotaBarRow
                      percent={quota.quota.apiPercentUsed}
                      label={t('profileCard.apiMode')}
                    />
                  </div>
                )}
                <div className="quota-details">
                  <span>{formatRemainingLabel(quota.quota, t)}</span>
                  <span>
                    {t('profileCard.resets', {
                      date: formatResetDate(quota.quota.billingCycleEnd, t),
                    })}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="quota-bar" aria-hidden="true">
                  <div
                    className={`quota-fill ${quotaStatus}`}
                    style={{
                      width: `${Math.min(100, Math.max(0, usagePercent))}%`,
                    }}
                  />
                </div>
                <div className="quota-text">
                  {isEnterprise && isMonthlySpend ? (
                    <>
                      <span className="percent">
                        {formatEnterpriseUsageLabel(quota.quota)}
                      </span>
                      <span className="label">{t('profileCard.used')}</span>
                    </>
                  ) : isMonthlySpend ? (
                    <>
                      <span className="percent">
                        {formatMonthlySpendLabel(quota.quota)}
                      </span>
                      <span className="label">{t('profileCard.monthly')}</span>
                    </>
                  ) : (
                    <>
                      <span className="percent">
                        {quota.quota.totalPercentUsed.toFixed(0)}%
                      </span>
                      <span className="label">{t('profileCard.used')}</span>
                    </>
                  )}
                  {renderQuotaStatusIcons(quotaStatus, t)}
                </div>
                <div className="quota-details">
                  {isEnterprise && isMonthlySpend ? (
                    hasDistinctTeamBudget(quota.quota) ? (
                      <span>
                        {t('profileCard.teamBudgetLabel', {
                          value: formatTeamBudgetLabel(quota.quota),
                        })}
                      </span>
                    ) : null
                  ) : isMonthlySpend ? (
                    <span>
                      {t('profileCard.monthlyLabel', {
                        value: formatMonthlySpendLabel(quota.quota),
                      })}
                    </span>
                  ) : (
                    <span>{formatRemainingLabel(quota.quota, t)}</span>
                  )}
                  <span>
                    {t('profileCard.resets', {
                      date: formatResetDate(quota.quota.billingCycleEnd, t),
                    })}
                  </span>
                </div>
              </>
            )
          ) : (
            <div className="quota-unavailable">{t('profileCard.quotaUnavailable')}</div>
          )}
        </div>
      )}

      {isEnterprise && leaderboardEntries.length ? (
        <div className="leaderboard-section">
          <button
            type="button"
            className="leaderboard-toggle"
            onClick={() => setLeaderboardExpanded((expanded) => !expanded)}
            aria-expanded={leaderboardExpanded}
          >
            <span className="leaderboard-status">{leaderboardStatusMessage}</span>
            <span className="leaderboard-period">{t('profileCard.leaderboardPeriod')}</span>
            <span className="leaderboard-chevron" aria-hidden="true">
              {leaderboardExpanded ? '▾' : '▸'}
            </span>
          </button>
          {leaderboardExpanded && (
            <ol className="leaderboard-list">
              {leaderboardEntries.map((entry) => (
                <li
                  key={entry.email}
                  className={
                    entry.email.toLowerCase() === profile.email.toLowerCase()
                      ? 'leaderboard-item self'
                      : 'leaderboard-item'
                  }
                >
                  <span className="rank">#{entry.rank}</span>
                  <span className="name">{entry.displayName}</span>
                  <span className="metric">
                    {formatCompactNumber(entry.composerLinesAccepted)} {t('profileCard.lines')}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}

      {profile.efficiencyAnalysisEnabled ? (
        efficiencyStats && efficiencyStats.totalPrompts > 0 ? (
          <div className="efficiency-section">
            <div className="efficiency-header">
              <span className="efficiency-title">
                {t('profileCard.efficiencyTitle')}
              </span>
              <span className="efficiency-percentage">
                {getEfficiencyPercentage(efficiencyStats)}%
              </span>
            </div>
            <QuotaBarRow
              percent={getEfficiencyPercentage(efficiencyStats)}
              fillStatus={getEfficiencyFillStatus(efficiencyStats)}
            />
            <div className="efficiency-details">
              <span>
                {t('profileCard.efficientPrompts', {
                  count: efficiencyStats.efficientPrompts,
                })}
              </span>
              <span>
                {t('profileCard.totalPrompts', {
                  count: efficiencyStats.totalPrompts,
                })}
              </span>
            </div>

            {Object.keys(efficiencyStats.byRepository).length > 0 ? (
              <div className="efficiency-by-repo">
                <button
                  type="button"
                  className="efficiency-repo-toggle"
                  onClick={() => setEfficiencyRepoExpanded((expanded) => !expanded)}
                  aria-expanded={efficiencyRepoExpanded}
                >
                  <span>
                    {t('profileCard.efficiencyByRepository', {
                      count: Object.keys(efficiencyStats.byRepository).length,
                    })}
                  </span>
                  <span className="chevron" aria-hidden="true">
                    {efficiencyRepoExpanded ? '▼' : '▶'}
                  </span>
                </button>
                {efficiencyRepoExpanded ? (
                  <ul className="efficiency-repo-list">
                    {Object.entries(efficiencyStats.byRepository)
                      .sort((a, b) => b[1].totalPrompts - a[1].totalPrompts)
                      .map(([repoPath, repoStats]) => {
                        const repoName = getRepositoryName(repoPath, workspaces);
                        const branchEntries = Object.entries(repoStats.byBranch);
                        const branchesExpanded = expandedBranchRepos.has(repoPath);

                        return (
                          <li key={repoPath} className="efficiency-repo-item">
                            <div className="efficiency-repo-header">
                              <span
                                className="efficiency-repo-name"
                                title={repoPath}
                              >
                                {repoName}
                              </span>
                              <span className="efficiency-repo-percent">
                                {getEfficiencyPercentage(repoStats)}%
                              </span>
                            </div>
                            <div className="efficiency-repo-stats">
                              <span className="efficiency-repo-count">
                                {repoStats.efficientPrompts}/{repoStats.totalPrompts}
                              </span>
                            </div>

                            {branchEntries.length > 0 ? (
                              <div className="efficiency-by-branch">
                                <button
                                  type="button"
                                  className="efficiency-branch-toggle"
                                  onClick={() => toggleBranchExpanded(repoPath)}
                                  aria-expanded={branchesExpanded}
                                >
                                  <span className="efficiency-branch-label">
                                    {t('profileCard.efficiencyByBranch', {
                                      count: branchEntries.length,
                                    })}
                                  </span>
                                  <span className="chevron-small" aria-hidden="true">
                                    {branchesExpanded ? '▼' : '▶'}
                                  </span>
                                </button>
                                {branchesExpanded ? (
                                  <ul className="efficiency-branch-list">
                                    {branchEntries
                                      .sort(
                                        (a, b) =>
                                          b[1].totalPrompts - a[1].totalPrompts
                                      )
                                      .map(([branchName, branchStats]) => (
                                        <li
                                          key={branchName}
                                          className="efficiency-branch-item"
                                        >
                                          <div className="efficiency-branch-header">
                                            <span className="efficiency-branch-name">
                                              {branchName}
                                            </span>
                                            <span className="efficiency-branch-percent">
                                              {getEfficiencyPercentage(branchStats)}%
                                            </span>
                                          </div>
                                          <div className="efficiency-branch-count">
                                            {branchStats.efficientPrompts}/
                                            {branchStats.totalPrompts}
                                          </div>
                                        </li>
                                      ))}
                                  </ul>
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="efficiency-section">
            <p className="efficiency-empty">{t('profileCard.efficiencyEmpty')}</p>
          </div>
        )
      ) : null}

      {displayedWorkspaces.length > 0 ? (
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
                  {summary ? (
                    <WorkspaceRepoMeta summary={summary} t={t} />
                  ) : null}
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
                  onClick={() => handleOpenProject(workspace.path)}
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
              onClick={() => onConfigureGithubToken(profile.id)}
            >
              {t('profileCard.configureGithubToken')}
            </button>
            {profile.githubTokenPath ? (
              <button
                type="button"
                className="btn-github-token-clear"
                onClick={() => onClearGithubToken(profile.id)}
              >
                {t('profileCard.clearGithubToken')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="profile-actions">
        <button
          type="button"
          className="btn-launch"
          onClick={handleLaunch}
          disabled={isCurrent || isRunning}
        >
          {isCurrent
            ? t('profileCard.currentWindow')
            : isRunning
              ? t('profileCard.alreadyRunning')
              : t('profileCard.launch')}
        </button>

        <div className="menu-container" ref={menuRef}>
          <button
            type="button"
            className="btn-menu"
            onClick={() => setShowMenu(!showMenu)}
            aria-label={t('profileCard.profileActions')}
            aria-expanded={showMenu}
          >
            ⋮
          </button>

          {showMenu && (
            <div className="menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onEdit(profile.id);
                  setShowMenu(false);
                }}
              >
                {t('profileCard.edit')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onShowInExplorer(profile.id);
                  setShowMenu(false);
                }}
              >
                {t('profileCard.showInExplorer')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onManageStorage(profile.id);
                  setShowMenu(false);
                }}
              >
                {t('profileCard.manageStorage')}
              </button>
              <button type="button" role="menuitem" onClick={handleDelete} disabled={isRunning}>
                {t('profileCard.delete')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
