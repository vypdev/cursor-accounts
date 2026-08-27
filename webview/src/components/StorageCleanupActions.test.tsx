import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { L10nProvider } from '../l10n/context';
import { StorageCleanupActions } from './StorageCleanupActions';

function renderActions(
  overrides: Partial<ComponentProps<typeof StorageCleanupActions>> = {}
): void {
  render(
    <L10nProvider locale="en" messages={{}}>
      <StorageCleanupActions
        profileId="profile-1"
        isCurrent
        isRunning={false}
        cleanupInProgress={false}
        onCleanStorage={vi.fn()}
        {...overrides}
      />
    </L10nProvider>
  );
}

function rowByLabel(label: string): HTMLElement {
  const row = screen.getByText(label).closest('.storage-action-row');
  if (!(row instanceof HTMLElement)) {
    throw new Error(`Storage action row not found: ${label}`);
  }
  return row;
}

describe('StorageCleanupActions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('submits quick actions with the selected chat age and confirmation', () => {
    const onCleanStorage = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderActions({ onCleanStorage });

    fireEvent.change(screen.getByLabelText('storage.deleteOldChats'), {
      target: { value: '90' },
    });
    fireEvent.click(
      within(rowByLabel('storage.deleteOldChats')).getByRole('button', {
        name: 'storage.run',
      })
    );
    fireEvent.click(
      within(rowByLabel('storage.gcAgentKv')).getByRole('button', {
        name: 'storage.run',
      })
    );
    fireEvent.click(
      within(rowByLabel('storage.cleanExtensionCache')).getByRole('button', {
        name: 'storage.run',
      })
    );

    expect(confirm).toHaveBeenNthCalledWith(
      1,
      'storage.confirmDeleteOldChats'
    );
    expect(confirm).toHaveBeenNthCalledWith(2, 'storage.confirmGcAgentKv');
    expect(confirm).toHaveBeenNthCalledWith(
      3,
      'storage.confirmExtensionCache'
    );
    expect(onCleanStorage).toHaveBeenNthCalledWith(
      1,
      'profile-1',
      'deleteOldChats',
      90
    );
    expect(onCleanStorage).toHaveBeenNthCalledWith(
      2,
      'profile-1',
      'gcAgentKvBlobs',
      undefined
    );
    expect(onCleanStorage).toHaveBeenNthCalledWith(
      3,
      'profile-1',
      'cleanExtensionCache',
      undefined
    );
  });

  it('honors current-window restrictions and cancelled confirmations', () => {
    const onCleanStorage = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderActions({ onCleanStorage, isCurrent: false });

    expect(
      within(rowByLabel('storage.deleteOldChats')).getByRole('button', {
        name: 'storage.run',
      })
    ).toBeDisabled();
    expect(
      within(rowByLabel('storage.gcAgentKv')).getByRole('button', {
        name: 'storage.run',
      })
    ).toBeDisabled();

    fireEvent.click(
      within(rowByLabel('storage.cleanExtensionCache')).getByRole('button', {
        name: 'storage.run',
      })
    );
    expect(confirm).toHaveBeenCalledWith('storage.confirmExtensionCache');
    expect(onCleanStorage).not.toHaveBeenCalled();
  });

  it('disables advanced actions while the profile is running and runs all actions otherwise', () => {
    renderActions({ isRunning: true });
    fireEvent.click(
      screen.getByRole('button', { name: 'storage.advancedActions' })
    );
    expect(screen.getByText('storage.profileRunningWarning')).toBeInTheDocument();
    const runningPanel = screen.getByText('storage.profileRunningWarning')
      .parentElement;
    if (!runningPanel) {
      throw new Error('Advanced storage panel not found');
    }
    expect(
      within(runningPanel)
        .getAllByRole('button', { name: 'storage.run' })
        .every((button) => (button as HTMLButtonElement).disabled)
    ).toBe(true);

    cleanup();
    const onCleanStorage = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderActions({ onCleanStorage });
    fireEvent.click(
      screen.getByRole('button', { name: 'storage.advancedActions' })
    );
    const panel = screen.getByText('storage.deepCleanHint').parentElement;
    if (!panel) {
      throw new Error('Advanced storage panel not found');
    }
    const actionButtons = within(panel).getAllByRole('button', {
      name: 'storage.run',
    });
    for (const button of actionButtons) {
      fireEvent.click(button);
    }

    expect(onCleanStorage).toHaveBeenCalledTimes(4);
    expect(onCleanStorage).toHaveBeenNthCalledWith(
      1,
      'profile-1',
      'cleanEditorCache',
      undefined
    );
    expect(onCleanStorage).toHaveBeenNthCalledWith(
      2,
      'profile-1',
      'vacuumDatabase',
      undefined
    );
    expect(onCleanStorage).toHaveBeenNthCalledWith(
      3,
      'profile-1',
      'deepCleanDatabase',
      undefined
    );
    expect(onCleanStorage).toHaveBeenNthCalledWith(
      4,
      'profile-1',
      'cleanEfficiencyEvents',
      undefined
    );
  });

  it('disables every cleanup button while a cleanup is in progress', () => {
    renderActions({ cleanupInProgress: true });

    expect(
      screen
        .getAllByRole('button', { name: 'storage.run' })
        .every((button) => (button as HTMLButtonElement).disabled)
    ).toBe(true);
    expect(screen.getByLabelText('storage.deleteOldChats')).toBeDisabled();
  });
});
