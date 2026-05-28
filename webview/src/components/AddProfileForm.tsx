import React, { useState } from 'react';

interface AddProfileFormProps {
  onSubmit: (
    email: string,
    displayName?: string,
    theme?: string,
    color?: string
  ) => void;
  onCancel: () => void;
}

export const AddProfileForm: React.FC<AddProfileFormProps> = ({
  onSubmit,
  onCancel,
}) => {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [theme, setTheme] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    if (!email.includes('@')) {
      setError('Invalid email format');
      return;
    }

    onSubmit(
      email.trim(),
      displayName.trim() || undefined,
      theme.trim() || undefined,
      color
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
          <h3 id="add-profile-title">Add Profile</h3>
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
            <label htmlFor="email">Email *</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="displayName">Display Name</label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g., Work, Personal"
            />
          </div>

          <div className="form-group">
            <label htmlFor="theme">Theme (optional)</label>
            <input
              id="theme"
              type="text"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="Dark+, Light+"
            />
          </div>

          <div className="form-group">
            <label htmlFor="color">Color</label>
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
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Create Profile
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
