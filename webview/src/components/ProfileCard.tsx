import React, { useEffect, useRef, useState } from 'react';
import { getEffectiveUsagePercent, getQuotaStatus, formatEnterpriseUsageLabel, formatMonthlySpendLabel, formatCompactNumber, isEnterpriseUsage, Profile, ProfileAccountView, ProfileQuota } from '../types';

interface ProfileCardProps {
  profile: Profile;
  isCurrent: boolean;
  account?: ProfileAccountView;
  quota?: ProfileQuota;
  isRunning: boolean;
  onLaunch: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onShowInExplorer: (id: string) => void;
  onToggleEfficiency: (id: string, enabled: boolean) => void;
}

function formatResetDate(isoString: string): string {
  if (!isoString) {
    return 'Unknown';
  }

  const numeric = Number(isoString);
  const date = Number.isFinite(numeric)
    ? new Date(numeric)
    : new Date(isoString);

  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  const now = new Date();
  const days = Math.ceil(
    (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (days <= 0) {
    return 'Today';
  }
  if (days === 1) {
    return 'Tomorrow';
  }
  return `${days} days`;
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
    return parts[0].charAt(0).toUpperCase();
  }
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}

export const ProfileCard: React.FC<ProfileCardProps> = ({
  profile,
  isCurrent,
  account,
  quota,
  isRunning,
  onLaunch,
  onEdit,
  onDelete,
  onShowInExplorer,
  onToggleEfficiency,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [leaderboardExpanded, setLeaderboardExpanded] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const quotaStatus = quota?.quota
    ? getQuotaStatus(quota.quota)
    : 'unavailable';

  const usagePercent = quota?.quota
    ? getEffectiveUsagePercent(quota.quota)
    : 0;

  const isMonthlySpend = quota?.quota?.displayMode === 'monthlySpend';
  const isEnterprise = isEnterpriseUsage(quota?.quota);

  const leaderboardEntries = quota?.activityLeaderboard?.entries ?? [];
  const isInTopActivity = leaderboardEntries.some(
    (entry) => entry.email.toLowerCase() === profile.email.toLowerCase()
  );
  const leaderboardStatusMessage = isInTopActivity
    ? "You're in the Top AI Activity 🔥"
    : "You're not in Cursor's Top Activity";

  const accountName = account?.accountName ?? profile.email;
  const showAvatar = account?.pictureUrl && !avatarError;

  useEffect(() => {
    setAvatarError(false);
  }, [account?.pictureUrl]);

  useEffect(() => {
    setLeaderboardExpanded(false);
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
    if (confirm(`Delete profile "${profile.displayName}"?`)) {
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
            <span className="running-indicator" title="Currently running">
              ●
            </span>
          )}
          <div className="profile-identity">
            <div className="profile-avatar-wrap">
              {showAvatar ? (
                <img
                  className="profile-avatar"
                  src={account!.pictureUrl}
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
              <span className="email">{profile.email}</span>
            </div>
          </div>
        </div>
        {isCurrent && <span className="badge">Active</span>}
      </div>

      {profile.theme && (
        <div className="profile-meta">
          <span className="theme">Theme: {profile.theme}</span>
        </div>
      )}

      {profile.lastLaunched && (
        <div className="profile-meta">
          <span className="last-launched">
            Last launched: {new Date(profile.lastLaunched).toLocaleDateString()}
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
                  Sign In
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
                      {formatEnterpriseUsageLabel(quota.quota!)}
                    </span>
                    <span className="label">used</span>
                  </>
                ) : isMonthlySpend ? (
                  <>
                    <span className="percent">
                      {formatMonthlySpendLabel(quota.quota!)}
                    </span>
                    <span className="label">monthly</span>
                  </>
                ) : (
                  <>
                    <span className="percent">
                      {quota.quota!.totalPercentUsed.toFixed(0)}%
                    </span>
                    <span className="label">used</span>
                  </>
                )}
                {quotaStatus === 'warning' && (
                  <span className="warning-icon" aria-label="Warning">
                    ⚠️
                  </span>
                )}
                {quotaStatus === 'critical' && (
                  <span className="error-icon" aria-label="Critical">
                    🔴
                  </span>
                )}
              </div>
              <div className="quota-details">
                {isEnterprise && isMonthlySpend ? (
                  <span>
                    Used: {formatEnterpriseUsageLabel(quota.quota!)}
                  </span>
                ) : isMonthlySpend ? (
                  <span>
                    Monthly: {formatMonthlySpendLabel(quota.quota!)}
                  </span>
                ) : (
                  <span>
                    Remaining: ${(quota.quota!.remaining / 100).toFixed(2)}
                  </span>
                )}
                <span>Resets: {formatResetDate(quota.quota!.billingCycleEnd)}</span>
              </div>
            </>
          ) : (
            <div className="quota-unavailable">Quota data unavailable</div>
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
            <span className="leaderboard-period">30d</span>
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
                    {formatCompactNumber(entry.composerLinesAccepted)} lines
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}

      <div className="efficiency-toggle">
        <label className="efficiency-label">
          <input
            type="checkbox"
            checked={Boolean(profile.efficiencyAnalysisEnabled)}
            onChange={(e) =>
              onToggleEfficiency(profile.id, e.target.checked)
            }
          />
          <span>
            {profile.efficiencyAnalysisEnabled
              ? 'Análisis de eficiencia activo'
              : 'Activar análisis de eficiencia'}
          </span>
        </label>
      </div>

      <div className="profile-actions">
        <button
          type="button"
          className="btn-launch"
          onClick={handleLaunch}
          disabled={isCurrent || isRunning}
        >
          {isCurrent
            ? 'Current Window'
            : isRunning
              ? 'Already Running'
              : 'Launch'}
        </button>

        <div className="menu-container" ref={menuRef}>
          <button
            type="button"
            className="btn-menu"
            onClick={() => setShowMenu(!showMenu)}
            aria-label="Profile actions"
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
                Edit
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onShowInExplorer(profile.id);
                  setShowMenu(false);
                }}
              >
                Show in Explorer
              </button>
              <button type="button" role="menuitem" onClick={handleDelete} disabled={isRunning}>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
