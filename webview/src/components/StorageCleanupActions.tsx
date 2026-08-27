import React, { useState } from 'react';
import { useL10n } from '../l10n/context';
import type { StorageCleanupAction } from '../types';

interface StorageCleanupActionsProps {
  profileId: string;
  isCurrent: boolean;
  isRunning: boolean;
  cleanupInProgress: boolean;
  onCleanStorage: (
    profileId: string,
    action: StorageCleanupAction,
    chatAgeDays?: number
  ) => void;
}

interface StorageActionRowProps {
  label: string;
  action: StorageCleanupAction;
  confirmKey: string;
  disabled: boolean;
  onRun: (
    action: StorageCleanupAction,
    confirmKey: string,
    confirmArgs?: Record<string, string | number>
  ) => void;
  title?: string;
  danger?: boolean;
}

const CHAT_AGE_OPTIONS = [7, 30, 90] as const;

const StorageActionRow: React.FC<StorageActionRowProps> = ({
  label,
  action,
  confirmKey,
  disabled,
  onRun,
  title,
  danger = false,
}) => {
  const { t } = useL10n();

  return (
    <div className="storage-action-row">
      <span>{label}</span>
      <button
        type="button"
        className={danger ? 'btn-secondary storage-danger' : 'btn-secondary'}
        disabled={disabled}
        title={title}
        onClick={() => onRun(action, confirmKey)}
      >
        {t('storage.run')}
      </button>
    </div>
  );
};

export const StorageCleanupActions: React.FC<StorageCleanupActionsProps> = ({
  profileId,
  isCurrent,
  isRunning,
  cleanupInProgress,
  onCleanStorage,
}) => {
  const { t } = useL10n();
  const [chatAgeDays, setChatAgeDays] = useState<number>(30);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const handleAction = (
    action: StorageCleanupAction,
    confirmKey: string,
    confirmArgs?: Record<string, string | number>
  ): void => {
    if (!confirm(t(confirmKey, confirmArgs))) {
      return;
    }

    onCleanStorage(
      profileId,
      action,
      action === 'deleteOldChats' ? chatAgeDays : undefined
    );
  };

  const currentWindowTitle = isCurrent
    ? undefined
    : t('storage.currentWindowRequired');

  return (
    <>
      <section className="storage-actions">
        <h4>{t('storage.quickActions')}</h4>

        <div className="storage-action-row">
          <label htmlFor={`chat-age-${profileId}`}>
            {t('storage.deleteOldChats')}
          </label>
          <div className="storage-action-controls">
            <select
              id={`chat-age-${profileId}`}
              value={chatAgeDays}
              onChange={(event) => setChatAgeDays(Number(event.target.value))}
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

        <StorageActionRow
          label={t('storage.gcAgentKv')}
          action="gcAgentKvBlobs"
          confirmKey="storage.confirmGcAgentKv"
          disabled={cleanupInProgress || !isCurrent}
          title={currentWindowTitle}
          onRun={handleAction}
        />

        <StorageActionRow
          label={t('storage.cleanExtensionCache')}
          action="cleanExtensionCache"
          confirmKey="storage.confirmExtensionCache"
          disabled={cleanupInProgress}
          onRun={handleAction}
        />
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
              <p className="storage-warning">
                {t('storage.profileRunningWarning')}
              </p>
            )}

            <StorageActionRow
              label={t('storage.cleanEditorCache')}
              action="cleanEditorCache"
              confirmKey="storage.confirmEditorCache"
              disabled={cleanupInProgress || isRunning}
              onRun={handleAction}
            />

            <StorageActionRow
              label={t('storage.vacuumDatabase')}
              action="vacuumDatabase"
              confirmKey="storage.confirmVacuum"
              disabled={cleanupInProgress || isRunning}
              onRun={handleAction}
            />

            <StorageActionRow
              label={t('storage.deepCleanDatabase')}
              action="deepCleanDatabase"
              confirmKey="storage.confirmDeepClean"
              disabled={cleanupInProgress || isRunning}
              danger
              onRun={handleAction}
            />
            <p className="storage-hint">{t('storage.deepCleanHint')}</p>

            <StorageActionRow
              label={t('storage.cleanEfficiencyEvents')}
              action="cleanEfficiencyEvents"
              confirmKey="storage.confirmCleanEfficiencyEvents"
              disabled={cleanupInProgress || isRunning}
              onRun={handleAction}
            />
            <p className="storage-hint">
              {t('storage.cleanEfficiencyEventsHint')}
            </p>
          </div>
        )}
      </section>
    </>
  );
};
