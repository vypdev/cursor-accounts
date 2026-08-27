import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { L10nProvider } from '../l10n/context';
import { createEmptyStorageBreakdown } from '../types';
import { StorageBreakdownTable } from './StorageBreakdownTable';

describe('StorageBreakdownTable', () => {
  it('renders the total and every storage category', () => {
    const storageInfo = createEmptyStorageBreakdown('profile-1');
    storageInfo.totalBytes = 4096;
    storageInfo.databaseBytes = 1024;
    storageInfo.walBytes = 512;
    storageInfo.workspaceStorageBytes = 256;
    storageInfo.editorCacheBytes = 128;
    storageInfo.extensionCacheBytes = 64;
    storageInfo.efficiencyDbBytes = 32;

    render(
      <L10nProvider locale="en" messages={{}}>
        <StorageBreakdownTable storageInfo={storageInfo} />
      </L10nProvider>
    );

    expect(screen.getByText('storage.total')).toBeInTheDocument();
    expect(screen.getByText('storage.database')).toBeInTheDocument();
    expect(screen.getByText('storage.wal')).toBeInTheDocument();
    expect(screen.getByText('storage.workspace')).toBeInTheDocument();
    expect(screen.getByText('storage.editorCache')).toBeInTheDocument();
    expect(screen.getByText('storage.extensionCache')).toBeInTheDocument();
    expect(screen.getByText('storage.efficiencyDb')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(6);
  });
});
