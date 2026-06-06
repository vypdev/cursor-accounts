import React, { useState } from 'react';
import { useL10n } from '../l10n/context';
import type { Profile } from '../types';
import { DEFAULT_PROFILE_EMOJI, EmojiPicker } from './EmojiPicker';

interface EditProfileFormProps {
  profile: Profile;
  isCurrent: boolean;
  onSubmit: (updates: Partial<Profile>) => void;
  onCancel: () => void;
}

export const EditProfileForm: React.FC<EditProfileFormProps> = ({
  profile,
  isCurrent,
  onSubmit,
  onCancel,
}) => {
  const { t } = useL10n();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [theme, setTheme] = useState(profile.theme ?? '');
  const [color, setColor] = useState(profile.color ?? '#3b82f6');
  const [emoji, setEmoji] = useState(profile.emoji ?? DEFAULT_PROFILE_EMOJI);
  const [notes, setNotes] = useState(profile.metadata?.notes ?? '');
  const [efficiencyEnabled, setEfficiencyEnabled] = useState(
    profile.efficiencyAnalysisEnabled ?? false
  );
  const [proxyEnabled, setProxyEnabled] = useState(
    profile.proxyEnabled !== false
  );
  const [proxyJsonlLoggingEnabled, setProxyJsonlLoggingEnabled] = useState(
    profile.proxyJsonlLoggingEnabled === true
  );
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!displayName.trim()) {
      setError(t('editProfile.displayNameRequired'));
      return;
    }

    const updates: Partial<Profile> = {
      displayName: displayName.trim(),
      theme: theme.trim() || undefined,
      color,
      emoji,
      metadata: {
        ...profile.metadata,
        notes: notes.trim() || undefined,
      },
      proxyEnabled,
      proxyJsonlLoggingEnabled: proxyEnabled ? proxyJsonlLoggingEnabled : false,
    };

    if (isCurrent) {
      updates.efficiencyAnalysisEnabled = efficiencyEnabled;
    }

    onSubmit(updates);
  };

  return (
    <div className="modal-overlay" onClick={onCancel} role="presentation">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="edit-profile-title"
      >
        <div className="modal-header">
          <h3 id="edit-profile-title">{t('editProfile.title')}</h3>
          <button
            type="button"
            className="btn-close"
            onClick={onCancel}
            aria-label={t('addProfile.close')}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="edit-email">{t('editProfile.emailLabel')}</label>
            <input
              id="edit-email"
              type="email"
              value={profile.email}
              readOnly
              disabled
            />
          </div>

          <div className="form-group">
            <label htmlFor="edit-displayName">{t('editProfile.displayNameLabel')}</label>
            <input
              id="edit-displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label>{t('editProfile.emojiLabel')}</label>
            <EmojiPicker value={emoji} onChange={setEmoji} />
          </div>

          <div className="form-group">
            <label htmlFor="edit-theme">{t('editProfile.themeLabel')}</label>
            <input
              id="edit-theme"
              type="text"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder={t('editProfile.themePlaceholder')}
            />
          </div>

          <div className="form-group">
            <label htmlFor="edit-color">{t('editProfile.colorLabel')}</label>
            <input
              id="edit-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="edit-notes">{t('editProfile.notesLabel')}</label>
            <input
              id="edit-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('editProfile.notesPlaceholder')}
            />
          </div>

          <div className="form-group checkbox">
            <label htmlFor="edit-proxy">
              <input
                id="edit-proxy"
                type="checkbox"
                checked={proxyEnabled}
                onChange={(e) => setProxyEnabled(e.target.checked)}
              />
              {t('editProfile.proxyLabel')}
            </label>
            <p className="form-help-text">{t('editProfile.proxyHelp')}</p>
          </div>

          {proxyEnabled ? (
            <div className="form-group checkbox">
              <label htmlFor="edit-proxy-jsonl">
                <input
                  id="edit-proxy-jsonl"
                  type="checkbox"
                  checked={proxyJsonlLoggingEnabled}
                  onChange={(e) => setProxyJsonlLoggingEnabled(e.target.checked)}
                />
                {t('editProfile.proxyJsonlLabel')}
              </label>
              <p className="form-help-text">{t('editProfile.proxyJsonlHelp')}</p>
              <p className="cert-install-warning">{t('editProfile.proxyJsonlDisclaimer')}</p>
            </div>
          ) : null}

          {isCurrent ? (
            <div className="form-group checkbox">
              <label htmlFor="edit-efficiency">
                <input
                  id="edit-efficiency"
                  type="checkbox"
                  checked={efficiencyEnabled}
                  onChange={(e) => setEfficiencyEnabled(e.target.checked)}
                />
                {t('editProfile.efficiencyLabel')}
              </label>
              <p className="form-help-text">{t('editProfile.efficiencyHelp')}</p>
            </div>
          ) : profile.efficiencyAnalysisEnabled ? (
            <p className="form-help-text">{t('editProfile.efficiencyHint')}</p>
          ) : null}

          {error && <div className="form-error">{error}</div>}

          <div className="form-actions">
            <button type="button" onClick={onCancel}>
              {t('editProfile.cancel')}
            </button>
            <button type="submit" className="btn-primary">
              {t('editProfile.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
