import { useEffect, useState } from 'react';
import { useL10n } from '../l10n/context';
import type { Profile, ProfileAccountView, ProfileQuota } from '../types';
import { formatMembershipType } from '../utils/formatters';
import { getInitials } from './profileCardPresentation';

interface ProfileCardIdentityProps {
  profile: Profile;
  isCurrent: boolean;
  hasOpenWorkspaceInSession: boolean;
  account?: ProfileAccountView;
  quota?: ProfileQuota;
  isRunning: boolean;
  proxyTemporary: boolean;
}

/** Renders profile identity, runtime badges, and profile metadata. */
export function ProfileCardIdentity({
  profile,
  isCurrent,
  hasOpenWorkspaceInSession,
  account,
  quota,
  isRunning,
  proxyTemporary,
}: ProfileCardIdentityProps) {
  const { t } = useL10n();
  const [avatarError, setAvatarError] = useState(false);
  const accountName = account?.accountName ?? profile.email;
  const showAvatar = Boolean(account?.pictureUrl && !avatarError);
  const membershipLabel = formatMembershipType(quota?.quota?.membershipType);

  useEffect(() => {
    setAvatarError(false);
  }, [account?.pictureUrl]);

  return (
    <>
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
                  src={account?.pictureUrl}
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
    </>
  );
}
