import React, { useEffect, useRef, useState } from 'react';
import { useL10n } from '../l10n/context';
import type {
  EfficiencyStats,
  GitHubRepoSummary,
  Profile,
  ProfileAccountView,
  ProfileGithubTokenStatus,
  ProfileQuota,
  WorkspaceInfo,
} from '../types';
import { getQuotaStatus, isEnterpriseUsage } from '../types';
import { formatMembershipType } from '../utils/formatters';
import { getInitials } from './profileCardPresentation';
import { ProfileCardEfficiency } from './ProfileCardEfficiency';
import { ProfileCardLeaderboard } from './ProfileCardLeaderboard';
import { ProfileCardQuota } from './ProfileCardQuota';
import { ProfileCardWorkspaces } from './ProfileCardWorkspaces';

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
  const menuRef = useRef<HTMLDivElement>(null);

  const accountName = account?.accountName ?? profile.email;
  const showAvatar = account?.pictureUrl && !avatarError;
  const membershipLabel = formatMembershipType(quota?.quota?.membershipType);
  const quotaStatus = quota?.quota ? getQuotaStatus(quota.quota) : 'unavailable';
  const leaderboardEntries = isEnterpriseUsage(quota?.quota)
    ? quota?.activityLeaderboard?.entries ?? []
    : [];

  useEffect(() => {
    setAvatarError(false);
  }, [account?.pictureUrl]);

  useEffect(() => {
    setLeaderboardExpanded(false);
    setQuotaExpanded(false);
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

      <ProfileCardQuota
        quota={quota}
        expanded={quotaExpanded}
        onToggleExpanded={() => setQuotaExpanded((expanded) => !expanded)}
        onLaunch={handleLaunch}
      />

      <ProfileCardLeaderboard
        entries={leaderboardEntries}
        profileEmail={profile.email}
        expanded={leaderboardExpanded}
        onToggleExpanded={() =>
          setLeaderboardExpanded((expanded) => !expanded)
        }
      />

      <ProfileCardEfficiency
        key={profile.id}
        enabled={Boolean(profile.efficiencyAnalysisEnabled)}
        stats={efficiencyStats}
        workspaces={workspaces}
      />

      <ProfileCardWorkspaces
        profile={profile}
        workspaces={workspaces}
        repoSummaries={repoSummaries}
        githubTokenStatus={githubTokenStatus}
        onOpenProject={(projectPath) => onOpenProject(profile.id, projectPath)}
        onConfigureGithubToken={() => onConfigureGithubToken(profile.id)}
        onClearGithubToken={() => onClearGithubToken(profile.id)}
      />

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
