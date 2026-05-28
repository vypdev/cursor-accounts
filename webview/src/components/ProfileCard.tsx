import React, { useEffect, useRef, useState } from 'react';
import { Profile } from '../types';

interface ProfileCardProps {
  profile: Profile;
  isCurrent: boolean;
  onLaunch: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onShowInExplorer: (id: string) => void;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({
  profile,
  isCurrent,
  onLaunch,
  onEdit,
  onDelete,
  onShowInExplorer,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
      className={`profile-card ${isCurrent ? 'current' : ''}`}
      style={{ borderLeftColor: borderColor }}
      role="listitem"
    >
      <div className="profile-header">
        <div className="profile-info">
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

      <div className="profile-actions">
        <button
          type="button"
          className="btn-launch"
          onClick={handleLaunch}
          disabled={isCurrent}
        >
          {isCurrent ? 'Current Window' : 'Launch'}
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
              <button type="button" role="menuitem" onClick={handleDelete}>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
