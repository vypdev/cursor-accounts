import React, { useEffect, useRef, useState } from 'react';
import { useL10n } from '../l10n/context';
import type {
  Profile,
  ProfileAccountView,
  ProfileQuota,
  QuotaStatus} from '../types';
import {
  getEffectiveUsagePercent,
  getPersonalModeAveragePercent,
  getQuotaStatus,
  formatEnterpriseUsageLabel,
  formatMonthlySpendLabel,
  formatTeamBudgetLabel,
  formatCompactNumber,
  hasDistinctTeamBudget,
  isEnterpriseUsage
} from '../types';

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
  const { t } = useL10n();
  const [showMenu, setShowMenu] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [leaderboardExpanded, setLeaderboardExpanded] = useState(false);
  const [quotaExpanded, setQuotaExpanded] = useState(false);
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
              <span className="email">{profile.email}</span>
            </div>
          </div>
        </div>
        {isCurrent && <span className="badge">{t('profileCard.active')}</span>}
      </div>

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
                  <span>
                    {t('profileCard.remaining', {
                      amount: (quota.quota.remaining / 100).toFixed(2),
                    })}
                  </span>
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
                    <span>
                      {t('profileCard.remaining', {
                        amount: (quota.quota.remaining / 100).toFixed(2),
                      })}
                    </span>
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

      {isCurrent ? (
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
                ? t('profileCard.efficiencyActive')
                : t('profileCard.efficiencyEnable')}
            </span>
          </label>
        </div>
      ) : profile.efficiencyAnalysisEnabled ? (
        <p className="efficiency-hint">
          {t('profileCard.efficiencyHint')}
        </p>
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
