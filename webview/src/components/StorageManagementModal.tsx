import React, { useEffect } from 'react';
import { useL10n } from '../l10n/context';
import type {
  Profile,
  StorageBreakdown,
  StorageCleanupAction,
  StorageCleanupResult,
} from '../types';
import { StorageBreakdownTable } from './StorageBreakdownTable';
import { StorageCleanupActions } from './StorageCleanupActions';

interface StorageManagementModalProps {
  profile: Profile;
  isCurrent: boolean;
  isRunning: boolean;
  storageInfo?: StorageBreakdown;
  storageLoading: boolean;
  cleanupInProgress: boolean;
  lastCleanupResult?: StorageCleanupResult;
  onRequestStorageInfo: (profileId: string) => void;
  onCleanStorage: (
    profileId: string,
    action: StorageCleanupAction,
    chatAgeDays?: number
  ) => void;
  onClose: () => void;
}

export const StorageManagementModal: React.FC<StorageManagementModalProps> = ({
  profile,
  isCurrent,
  isRunning,
  storageInfo,
  storageLoading,
  cleanupInProgress,
  lastCleanupResult,
  onRequestStorageInfo,
  onCleanStorage,
  onClose,
}) => {
  const { t } = useL10n();

  useEffect(() => {
    onRequestStorageInfo(profile.id);
  }, [profile.id, onRequestStorageInfo]);

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal storage-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-labelledby="storage-management-title"
      >
        <div className="modal-header">
          <h3 id="storage-management-title">{t('storage.title')}</h3>
          <button
            type="button"
            className="btn-close"
            onClick={onClose}
            aria-label={t('addProfile.close')}
          >
            ×
          </button>
        </div>

        <div className="storage-modal-body">
          <p className="storage-profile-name">{profile.displayName}</p>

          {storageLoading && !storageInfo ? (
            <div className="storage-loading">
              <div className="spinner" aria-hidden="true" />
              <span>{t('storage.loading')}</span>
            </div>
          ) : storageInfo?.error ? (
            <div className="storage-error" role="alert">
              {storageInfo.error}
            </div>
          ) : storageInfo ? (
            <StorageBreakdownTable storageInfo={storageInfo} />
          ) : null}

          {lastCleanupResult && (
            <div
              className={
                lastCleanupResult.success
                  ? 'storage-result success'
                  : 'storage-result error'
              }
              role="status"
            >
              {lastCleanupResult.message}
            </div>
          )}

          <StorageCleanupActions
            profileId={profile.id}
            isCurrent={isCurrent}
            isRunning={isRunning}
            cleanupInProgress={cleanupInProgress}
            onCleanStorage={onCleanStorage}
          />

          {cleanupInProgress && (
            <div className="storage-loading inline">
              <div className="spinner" aria-hidden="true" />
              <span>{t('storage.cleanupInProgress')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
