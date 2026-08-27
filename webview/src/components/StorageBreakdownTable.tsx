import React from 'react';
import { useL10n } from '../l10n/context';
import type { StorageBreakdown } from '../types';
import { formatBytes } from '../utils/formatters';

interface StorageBreakdownTableProps {
  storageInfo: StorageBreakdown;
}

export const StorageBreakdownTable: React.FC<StorageBreakdownTableProps> = ({
  storageInfo,
}) => {
  const { t } = useL10n();
  const rows = [
    { label: t('storage.database'), value: storageInfo.databaseBytes },
    { label: t('storage.wal'), value: storageInfo.walBytes },
    {
      label: t('storage.workspace'),
      value: storageInfo.workspaceStorageBytes,
    },
    { label: t('storage.editorCache'), value: storageInfo.editorCacheBytes },
    {
      label: t('storage.extensionCache'),
      value: storageInfo.extensionCacheBytes,
    },
    { label: t('storage.efficiencyDb'), value: storageInfo.efficiencyDbBytes },
  ];

  return (
    <>
      <div className="storage-total">
        <span className="storage-total-label">{t('storage.total')}</span>
        <span className="storage-total-value">
          {formatBytes(storageInfo.totalBytes)}
        </span>
      </div>

      <table className="storage-breakdown">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{formatBytes(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};
