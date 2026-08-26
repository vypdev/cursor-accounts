import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { EfficiencyEventsCleanupService } from '../../persistence/efficiencyEventsCleanupService';
import {
  EfficiencyDatabase,
  getEfficiencyDbPath,
} from '../../persistence/efficiencyDatabase';
import type { PromptEventRecord } from '../../persistence/types';

const extensionPath = path.join(__dirname, '..', '..', '..');

function makeEvent(
  profileId: string,
  timestamp: number
): PromptEventRecord {
  return {
    profileId,
    timestamp,
    promptText: 'Test prompt',
    modelUsed: 'test-model',
    efficiencyScore: 0.8,
    severity: 'low',
    confidence: 0.9,
    taskType: 'factual_simple',
    conversationId: 'conversation-1',
    scoredAt: timestamp,
    requiredTier: 1,
    actualTier: 1,
    recommendedModel: 'test-model',
    opinion: 'Test opinion',
  };
}

describe('EfficiencyEventsCleanupService', () => {
  let tempDir = '';

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('removes only expired events for the requested profile', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-cleanup-'));
    const profileId = 'profile-1';
    const otherProfileId = 'profile-2';
    const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60;
    const database = new EfficiencyDatabase(
      getEfficiencyDbPath(tempDir),
      extensionPath
    );
    await database.initialize();
    await database.insertEvent(makeEvent(profileId, (cutoff - 1) * 1000));
    await database.insertEvent(makeEvent(profileId, (cutoff + 1) * 1000));
    await database.insertEvent(makeEvent(otherProfileId, (cutoff - 1) * 1000));

    const service = new EfficiencyEventsCleanupService({ extensionPath });
    const result = await service.cleanOldEvents(profileId, tempDir, cutoff);

    assert.equal(result.removedEvents, 1);
    assert.ok(result.bytesReclaimed >= 0);
    assert.equal((await database.getEventsWithQuota(profileId)).length, 1);
    assert.equal((await database.getEventsWithQuota(otherProfileId)).length, 1);
  });

  it('initializes an empty profile database without reporting negative savings', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-cleanup-'));

    const service = new EfficiencyEventsCleanupService({ extensionPath });
    const result = await service.cleanOldEvents(
      'profile-1',
      tempDir,
      Math.floor(Date.now() / 1000)
    );

    assert.deepEqual(result, { removedEvents: 0, bytesReclaimed: 0 });
    assert.equal(
      await fs.stat(getEfficiencyDbPath(tempDir)).then((stat) => stat.isFile()),
      true
    );
  });
});
