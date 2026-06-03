import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  EFFICIENCY_STATS_FILENAME,
  EfficiencyStatsStorage,
} from '../../modelEfficiency/efficiencyStatsStorage';
import { EFFICIENCY_DB_FILENAME } from '../../persistence/types';
import type { Profile } from '../../profiles/types';
import type { PromptEventRecord } from '../../persistence/types';

const extensionPath = path.join(__dirname, '..', '..', '..');

function makeProfile(userDataDir: string): Profile {
  return {
    id: 'profile-1',
    email: 'user@example.com',
    slug: 'user-example-com',
    displayName: 'User',
    userDataDir,
    created: new Date().toISOString(),
    efficiencyAnalysisEnabled: true,
  };
}

function makeEvent(profileId: string): PromptEventRecord {
  return {
    profileId,
    timestamp: Date.now(),
    promptText: 'Explain this function',
    modelUsed: 'claude-4-sonnet',
    efficiencyScore: 0.85,
    severity: 'low',
    confidence: 0.9,
    taskType: 'explanation',
    repositoryPath: '/repo/web-app',
    branchName: 'main',
    conversationId: 'conv-1',
    scoredAt: Date.now(),
    requiredTier: 2,
    actualTier: 2,
    recommendedModel: 'auto',
    opinion: 'Good match',
    quotaPercentUsed: 20,
  };
}

describe('EfficiencyStatsStorage', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('records account, repository, and branch stats in SQLite', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-stats-'));
    const profile = makeProfile(tempDir);
    const storage = new EfficiencyStatsStorage(extensionPath);

    await storage.recordEvent(profile, makeEvent(profile.id));
    await storage.recordEvent(profile, {
      ...makeEvent(profile.id),
      efficiencyScore: 0.4,
      branchName: 'feature/auth',
    });
    await storage.recordEvent(profile, {
      ...makeEvent(profile.id),
      repositoryPath: '/repo/mobile-app',
      branchName: 'develop',
    });

    const stats = storage.getStats(profile.id);
    assert.ok(stats);
    assert.equal(stats.totalPrompts, 3);
    assert.equal(stats.efficientPrompts, 2);
    assert.equal(stats.inefficientPrompts, 1);

    const dbPath = path.join(
      tempDir,
      'User',
      'globalStorage',
      EFFICIENCY_DB_FILENAME
    );
    await fs.access(dbPath);
  });

  it('loads persisted stats on startup', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-stats-'));
    const profile = makeProfile(tempDir);
    const writer = new EfficiencyStatsStorage(extensionPath);
    await writer.recordEvent(profile, makeEvent(profile.id));

    const reader = new EfficiencyStatsStorage(extensionPath);
    const loaded = await reader.loadStats(profile);
    assert.ok(loaded);
    assert.equal(loaded.totalPrompts, 1);
    const repo = loaded.byRepository['/repo/web-app'];
    assert.ok(repo?.byBranch.main);
    assert.equal(repo.byBranch.main.totalPrompts, 1);
  });

  it('deletes stats database', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-stats-'));
    const profile = makeProfile(tempDir);
    const storage = new EfficiencyStatsStorage(extensionPath);
    await storage.recordEvent(profile, makeEvent(profile.id));
    await storage.deleteStats(profile);

    const dbPath = path.join(
      tempDir,
      'User',
      'globalStorage',
      EFFICIENCY_DB_FILENAME
    );
    await assert.rejects(() => fs.access(dbPath));
    assert.equal(storage.getStats(profile.id), undefined);

    const legacyPath = path.join(
      tempDir,
      'User',
      'globalStorage',
      EFFICIENCY_STATS_FILENAME
    );
    await assert.rejects(() => fs.access(legacyPath));
  });
});
