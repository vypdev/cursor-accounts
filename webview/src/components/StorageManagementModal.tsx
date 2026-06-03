import React, { useEffect, useState } from 'react';
import { useL10n } from '../l10n/context';
import type {
  Profile,
  StorageBreakdown,
  StorageCleanupAction,
  StorageCleanupResult,
} from '../types';
import { formatBytes } from '../utils/formatters';

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

const CHAT_AGE_OPTIONS = [7, 30, 90] as const;

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
  const [chatAgeDays, setChatAgeDays] = useState<number>(30);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    onRequestStorageInfo(profile.id);
  }, [profile.id, onRequestStorageInfo]);

  const handleAction = (
    action: StorageCleanupAction,
    confirmKey?: string,
    confirmArgs?: Record<string, string | number>
  ) => {
    if (confirmKey) {
      const confirmed = confirm(t(confirmKey, confirmArgs));
      if (!confirmed) {
        return;
      }
    }

    onCleanStorage(
      profile.id,
      action,
      action === 'deleteOldChats' ? chatAgeDays : undefined
    );
  };

  const breakdownRows = storageInfo
    ? [
        {
          label: t('storage.database'),
          value: formatBytes(storageInfo.databaseBytes),
        },
        {
          label: t('storage.wal'),
          value: formatBytes(storageInfo.walBytes),
        },
        {
          label: t('storage.workspace'),
          value: formatBytes(storageInfo.workspaceStorageBytes),
        },
        {
          label: t('storage.editorCache'),
          value: formatBytes(storageInfo.editorCacheBytes),
        },
        {
          label: t('storage.extensionCache'),
          value: formatBytes(storageInfo.extensionCacheBytes),
        },
        {
          label: t('storage.efficiencyDb'),
          value: formatBytes(storageInfo.efficiencyDbBytes),
        },
      ]
    : [];

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
            <>
              <div className="storage-total">
                <span className="storage-total-label">{t('storage.total')}</span>
                <span className="storage-total-value">
                  {formatBytes(storageInfo.totalBytes)}
                </span>
              </div>

              <table className="storage-breakdown">
                <tbody>
                  {breakdownRows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      <td>{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
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

          <section className="storage-actions">
            <h4>{t('storage.quickActions')}</h4>

            <div className="storage-action-row">
              <label htmlFor={`chat-age-${profile.id}`}>
                {t('storage.deleteOldChats')}
              </label>
              <div className="storage-action-controls">
                <select
                  id={`chat-age-${profile.id}`}
                  value={chatAgeDays}
                  onChange={(event) =>
                    setChatAgeDays(Number(event.target.value))
                  }
                  disabled={cleanupInProgress}
                >
                  {CHAT_AGE_OPTIONS.map((days) => (
                    <option key={days} value={days}>
                      {t('storage.daysOption', { days })}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={cleanupInProgress || !isCurrent}
                  title={
                    isCurrent
                      ? t('storage.deleteOldChatsHint')
                      : t('storage.currentWindowRequired')
                  }
                  onClick={() =>
                    handleAction(
                      'deleteOldChats',
                      'storage.confirmDeleteOldChats',
                      { days: chatAgeDays }
                    )
                  }
                >
                  {t('storage.run')}
                </button>
              </div>
            </div>

            <div className="storage-action-row">
              <span>{t('storage.gcAgentKv')}</span>
              <button
                type="button"
                className="btn-secondary"
                disabled={cleanupInProgress || !isCurrent}
                title={
                  isCurrent
                    ? undefined
                    : t('storage.currentWindowRequired')
                }
                onClick={() =>
                  handleAction('gcAgentKvBlobs', 'storage.confirmGcAgentKv')
                }
              >
                {t('storage.run')}
              </button>
            </div>

            <div className="storage-action-row">
              <span>{t('storage.cleanExtensionCache')}</span>
              <button
                type="button"
                className="btn-secondary"
                disabled={cleanupInProgress}
                onClick={() =>
                  handleAction(
                    'cleanExtensionCache',
                    'storage.confirmExtensionCache'
                  )
                }
              >
                {t('storage.run')}
              </button>
            </div>
          </section>

          <section className="storage-actions storage-advanced">
            <button
              type="button"
              className="storage-advanced-toggle"
              onClick={() => setAdvancedOpen((open) => !open)}
              aria-expanded={advancedOpen}
            >
              {t('storage.advancedActions')}
              <span aria-hidden="true">{advancedOpen ? '▾' : '▸'}</span>
            </button>

            {advancedOpen && (
              <div className="storage-advanced-panel">
                {isRunning && (
                  <p className="storage-warning">{t('storage.profileRunningWarning')}</p>
                )}

                <div className="storage-action-row">
                  <span>{t('storage.cleanEditorCache')}</span>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={cleanupInProgress || isRunning}
                    onClick={() =>
                      handleAction(
                        'cleanEditorCache',
                        'storage.confirmEditorCache'
                      )
                    }
                  >
                    {t('storage.run')}
                  </button>
                </div>

                <div className="storage-action-row">
                  <span>{t('storage.vacuumDatabase')}</span>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={cleanupInProgress || isRunning}
                    onClick={() =>
                      handleAction('vacuumDatabase', 'storage.confirmVacuum')
                    }
                  >
                    {t('storage.run')}
                  </button>
                </div>

                <div className="storage-action-row">
                  <span>{t('storage.deepCleanDatabase')}</span>
                  <button
                    type="button"
                    className="btn-secondary storage-danger"
                    disabled={cleanupInProgress || isRunning}
                    onClick={() =>
                      handleAction(
                        'deepCleanDatabase',
                        'storage.confirmDeepClean'
                      )
                    }
                  >
                    {t('storage.run')}
                  </button>
                </div>
                <p className="storage-hint">{t('storage.deepCleanHint')}</p>

                <div className="storage-action-row">
                  <span>{t('storage.cleanEfficiencyEvents')}</span>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={cleanupInProgress || isRunning}
                    onClick={() =>
                      handleAction(
                        'cleanEfficiencyEvents',
                        'storage.confirmCleanEfficiencyEvents'
                      )
                    }
                  >
                    {t('storage.run')}
                  </button>
                </div>
                <p className="storage-hint">
                  {t('storage.cleanEfficiencyEventsHint')}
                </p>
              </div>
            )}
          </section>

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
