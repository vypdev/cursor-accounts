import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import type { ICacheCleanupService } from '../../domain/ports/ICacheCleanupService';
import type { IDatabaseCleanupService } from '../../domain/ports/IDatabaseCleanupService';
import type { IEfficiencyEventsCleanupService } from '../../domain/ports/IEfficiencyEventsCleanupService';
import type { IInstanceDetector } from '../../domain/ports/IInstanceDetector';
import type { IProfileDetector } from '../../domain/ports/IProfileDetector';
import { initL10nForTests } from '../../l10n';
import {
  StorageCleanupActionRunner,
  type StorageCleanupActionRunnerDeps,
} from '../../services/storageCleanupActionRunner';

const MESSAGES: Record<string, string> = {
  'storageCleanup.deleteOldChatsStarted': 'Delete old chats started ({days} days)',
  'storageCleanup.profileRunning': 'Profile is running',
  'storageCleanup.vacuumCompleted': 'Vacuum completed',
  'storageCleanup.efficiencyEventsCleaned':
    'Cleaned {count} events older than {days} days ({amount})',
};

function createRunner(overrides: {
  profileDetector?: Partial<IProfileDetector>;
  instanceDetector?: Partial<IInstanceDetector>;
  cacheCleanup?: Partial<ICacheCleanupService>;
  databaseCleanup?: Partial<IDatabaseCleanupService>;
  efficiencyEventsCleanup?: Partial<IEfficiencyEventsCleanupService>;
} = {}): StorageCleanupActionRunner {
  const deps: StorageCleanupActionRunnerDeps = {
    profileDetector: {
      detectCurrentProfile: async () => ({ id: 'p1' } as never),
      ...overrides.profileDetector,
    } as IProfileDetector,
    instanceDetector: {
      isProfileRunning: async () => false,
      ...overrides.instanceDetector,
    } as IInstanceDetector,
    cacheCleanup: {
      cleanExtensionCache: async () => undefined,
      cleanEditorCache: async () => 0,
      deleteOldChats: async () => true,
      gcAgentKvBlobs: async () => true,
      ...overrides.cacheCleanup,
    },
    databaseCleanup: {
      vacuum: async () => undefined,
      deepClean: async () => ({ backupPath: '/tmp/backup', bytesReclaimed: 0 }),
      restoreDeepCleanBackup: async () => undefined,
      ...overrides.databaseCleanup,
    },
    efficiencyEventsCleanup: {
      cleanOldEvents: async () => ({ removedEvents: 0, bytesReclaimed: 0 }),
      ...overrides.efficiencyEventsCleanup,
    },
  };

  return new StorageCleanupActionRunner(deps);
}

describe('StorageCleanupActionRunner', () => {
  beforeEach(() => {
    initL10nForTests(MESSAGES);
  });

  it('executes current-window chat cleanup with the requested age', async () => {
    const deleteOldChats = mock.fn(async () => true);
    const runner = createRunner({ cacheCleanup: { deleteOldChats } });

    const result = await runner.run('p1', '/tmp/profile', {
      action: 'deleteOldChats',
      chatAgeDays: 14,
    });

    assert.equal(result.success, true);
    assert.deepEqual(deleteOldChats.mock.calls[0]?.arguments, [14]);
  });

  it('blocks closed-profile actions while an instance is running', async () => {
    const cleanEditorCache = mock.fn(async () => 10);
    const runner = createRunner({
      instanceDetector: { isProfileRunning: async () => true },
      cacheCleanup: { cleanEditorCache },
    });

    await assert.rejects(
      runner.run('p1', '/tmp/profile', { action: 'cleanEditorCache' }),
      /Profile is running/
    );
    assert.equal(cleanEditorCache.mock.callCount(), 0);
  });

  it('delegates efficiency-event retention and formats the result', async () => {
    const cleanOldEvents = mock.fn(async () => ({
      removedEvents: 3,
      bytesReclaimed: 256,
    }));
    const runner = createRunner({ efficiencyEventsCleanup: { cleanOldEvents } });

    const result = await runner.run('p1', '/tmp/profile', {
      action: 'cleanEfficiencyEvents',
    });

    assert.equal(result.success, true);
    assert.equal(result.bytesReclaimed, 256);
    assert.match(result.message, /3 events older than 90 days/);
    assert.equal(cleanOldEvents.mock.callCount(), 1);
  });
});
