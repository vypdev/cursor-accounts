import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { L10nProvider } from '../l10n/context';
import { createEmptyStorageBreakdown, type Profile } from '../types';
import { StorageManagementModal } from './StorageManagementModal';

const profile: Profile = {
  id: 'profile-1',
  email: 'profile@example.com',
  slug: 'profile',
  displayName: 'Profile',
  userDataDir: '/tmp/profile',
  created: '2026-01-01T00:00:00.000Z',
};

function renderModal(
  overrides: Partial<ComponentProps<typeof StorageManagementModal>> = {}
): void {
  render(
    <L10nProvider locale="en" messages={{}}>
      <StorageManagementModal
        profile={profile}
        isCurrent
        isRunning={false}
        storageLoading={false}
        cleanupInProgress={false}
        onRequestStorageInfo={vi.fn()}
        onCleanStorage={vi.fn()}
        onClose={vi.fn()}
        {...overrides}
      />
    </L10nProvider>
  );
}

describe('StorageManagementModal', () => {
  it('requests storage information on mount and closes through the overlay', () => {
    const onRequestStorageInfo = vi.fn();
    const onClose = vi.fn();
    renderModal({ onRequestStorageInfo, onClose, storageLoading: true });

    expect(onRequestStorageInfo).toHaveBeenCalledWith('profile-1');
    expect(screen.getByText('storage.loading')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders a storage error and the failed cleanup result', () => {
    const storageInfo = createEmptyStorageBreakdown('profile-1', 'Read failed');
    renderModal({
      storageInfo,
      lastCleanupResult: {
        success: false,
        bytesReclaimed: 0,
        message: 'Cleanup failed',
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Read failed');
    expect(screen.getByRole('status')).toHaveTextContent('Cleanup failed');
  });

  it('renders a successful breakdown and cleanup progress state', () => {
    const storageInfo = createEmptyStorageBreakdown('profile-1');
    storageInfo.totalBytes = 2048;
    renderModal({ storageInfo, cleanupInProgress: true });

    expect(screen.getByText('storage.total')).toBeInTheDocument();
    expect(screen.getByText('storage.database')).toBeInTheDocument();
    expect(screen.getByText('storage.cleanupInProgress')).toBeInTheDocument();
  });
});
