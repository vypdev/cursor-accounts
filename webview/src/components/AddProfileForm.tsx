import React, { useEffect, useState } from 'react';
import { useL10n } from '../l10n/context';
import { DEFAULT_PROFILE_EMOJI, EmojiPicker } from './EmojiPicker';

interface AddProfileFormProps {
  onSubmit: (
    email: string,
    displayName?: string,
    theme?: string,
    color?: string,
    emoji?: string
  ) => void;
  onCancel: () => void;
  suggestedEmail?: string;
  suggestedDisplayName?: string;
  notice?: string;
}

export const AddProfileForm: React.FC<AddProfileFormProps> = ({
  onSubmit,
  onCancel,
  suggestedEmail,
  suggestedDisplayName,
  notice,
}) => {
  const { t } = useL10n();
  const [email, setEmail] = useState(suggestedEmail || '');
  const [displayName, setDisplayName] = useState(suggestedDisplayName || '');
  const [theme, setTheme] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [emoji, setEmoji] = useState(DEFAULT_PROFILE_EMOJI);
  const [error, setError] = useState('');

  useEffect(() => {
    if (suggestedEmail) {
      setEmail(suggestedEmail);
    }
    if (suggestedDisplayName) {
      setDisplayName(suggestedDisplayName);
    }
  }, [suggestedEmail, suggestedDisplayName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setError(t('addProfile.emailRequired'));
      return;
    }

    if (!email.includes('@')) {
      setError(t('addProfile.invalidEmail'));
      return;
    }

    onSubmit(
      email.trim(),
      displayName.trim() || undefined,
      theme.trim() || undefined,
      color,
      emoji
    );
  };

  return (
    <div className="modal-overlay" onClick={onCancel} role="presentation">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="add-profile-title"
      >
        <div className="modal-header">
          <h3 id="add-profile-title">{t('addProfile.title')}</h3>
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
          {notice && (
            <div className="notice-banner" role="status">
              {notice}
            </div>
          )}

          {suggestedEmail && (
            <div className="info-banner">
              {t('addProfile.detectedAccount', { email: suggestedEmail })}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">{t('addProfile.emailLabel')}</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('addProfile.emailPlaceholder')}
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="displayName">{t('addProfile.displayNameLabel')}</label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('addProfile.displayNamePlaceholder')}
            />
          </div>

          <div className="form-group">
            <label>{t('addProfile.emojiLabel')}</label>
            <EmojiPicker value={emoji} onChange={setEmoji} />
          </div>

          <div className="form-group">
            <label htmlFor="theme">{t('addProfile.themeLabel')}</label>
            <input
              id="theme"
              type="text"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder={t('addProfile.themePlaceholder')}
            />
          </div>

          <div className="form-group">
            <label htmlFor="color">{t('addProfile.colorLabel')}</label>
            <input
              id="color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="form-actions">
            <button type="button" onClick={onCancel}>
              {t('addProfile.cancel')}
            </button>
            <button type="submit" className="btn-primary">
              {t('addProfile.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
