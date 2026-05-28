import React, { useState } from 'react';
import { Profile } from '../types';
import { DEFAULT_PROFILE_EMOJI, EmojiPicker } from './EmojiPicker';

interface EditProfileFormProps {
  profile: Profile;
  onSubmit: (updates: Partial<Profile>) => void;
  onCancel: () => void;
}

export const EditProfileForm: React.FC<EditProfileFormProps> = ({
  profile,
  onSubmit,
  onCancel,
}) => {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [theme, setTheme] = useState(profile.theme ?? '');
  const [color, setColor] = useState(profile.color ?? '#3b82f6');
  const [emoji, setEmoji] = useState(profile.emoji ?? DEFAULT_PROFILE_EMOJI);
  const [notes, setNotes] = useState(profile.metadata?.notes ?? '');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!displayName.trim()) {
      setError('Display name is required');
      return;
    }

    onSubmit({
      displayName: displayName.trim(),
      theme: theme.trim() || undefined,
      color,
      emoji,
      metadata: {
        ...profile.metadata,
        notes: notes.trim() || undefined,
      },
    });
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
          <h3 id="edit-profile-title">Edit Profile</h3>
          <button
            type="button"
            className="btn-close"
            onClick={onCancel}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="edit-email">Email</label>
            <input
              id="edit-email"
              type="email"
              value={profile.email}
              readOnly
              disabled
            />
          </div>

          <div className="form-group">
            <label htmlFor="edit-displayName">Display Name *</label>
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
            <label>Emoji</label>
            <EmojiPicker value={emoji} onChange={setEmoji} />
          </div>

          <div className="form-group">
            <label htmlFor="edit-theme">Theme (optional)</label>
            <input
              id="edit-theme"
              type="text"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="Dark+, Light+"
            />
          </div>

          <div className="form-group">
            <label htmlFor="edit-color">Color</label>
            <input
              id="edit-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="edit-notes">Notes (optional)</label>
            <input
              id="edit-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Personal projects, client work, etc."
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="form-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
