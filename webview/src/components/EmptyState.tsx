import React from 'react';
import { useL10n } from '../l10n/context';

interface EmptyStateProps {
  onAddProfile: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onAddProfile }) => {
  const { t } = useL10n();

  return (
    <div className="empty-state">
      <div className="icon" aria-hidden="true">
        👤
      </div>
      <h3>{t('emptyState.title')}</h3>
      <p>{t('emptyState.description')}</p>
      <button type="button" className="btn-primary" onClick={onAddProfile}>
        {t('emptyState.button')}
      </button>
    </div>
  );
};
