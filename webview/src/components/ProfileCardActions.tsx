import { useEffect, useRef, useState } from 'react';
import { useL10n } from '../l10n/context';
import type { Profile } from '../types';

interface ProfileCardActionsProps {
  profile: Profile;
  isCurrent: boolean;
  isRunning: boolean;
  onLaunch: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onShowInExplorer: () => void;
  onManageStorage: () => void;
}

/** Renders profile launch and menu actions with local menu lifecycle state. */
export function ProfileCardActions({
  profile,
  isCurrent,
  isRunning,
  onLaunch,
  onEdit,
  onDelete,
  onShowInExplorer,
  onManageStorage,
}: ProfileCardActionsProps) {
  const { t } = useL10n();
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

  const handleDelete = () => {
    if (confirm(t('profileCard.deleteConfirm', { name: profile.displayName }))) {
      onDelete();
      setShowMenu(false);
    }
  };

  return (
    <div className="profile-actions">
      <button
        type="button"
        className="btn-launch"
        onClick={onLaunch}
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
          onClick={() => setShowMenu((visible) => !visible)}
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
                onEdit();
                setShowMenu(false);
              }}
            >
              {t('profileCard.edit')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onShowInExplorer();
                setShowMenu(false);
              }}
            >
              {t('profileCard.showInExplorer')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onManageStorage();
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
  );
}
