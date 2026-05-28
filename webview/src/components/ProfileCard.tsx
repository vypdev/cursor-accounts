import React, { useEffect, useRef, useState } from 'react';
import { getQuotaStatus, Profile, ProfileQuota } from '../types';

interface ProfileCardProps {
  profile: Profile;
  isCurrent: boolean;
  quota?: ProfileQuota;
  isRunning: boolean;
  onLaunch: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onShowInExplorer: (id: string) => void;
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

export const ProfileCard: React.FC<ProfileCardProps> = ({
  profile,
  isCurrent,
  quota,
  isRunning,
  onLaunch,
  onEdit,
  onDelete,
  onShowInExplorer,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const quotaStatus = quota?.quota
    ? getQuotaStatus(quota.quota)
    : 'unavailable';

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
          <h3>{profile.displayName}</h3>
          <span className="email">{profile.email}</span>
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
                    width: `${Math.min(100, Math.max(0, quota.quota.totalPercentUsed))}%`,
                  }}
                />
              </div>
              <div className="quota-text">
                <span className="percent">
                  {quota.quota.totalPercentUsed.toFixed(0)}%
                </span>
                <span className="label">used</span>
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
                <span>
                  Remaining: ${(quota.quota.remaining / 100).toFixed(2)}
                </span>
                <span>Resets: {formatResetDate(quota.quota.billingCycleEnd)}</span>
              </div>
            </>
          ) : (
            <div className="quota-unavailable">Quota data unavailable</div>
          )}
        </div>
      )}

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
