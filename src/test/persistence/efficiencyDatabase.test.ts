import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { EFFICIENCY_SCORE_THRESHOLD } from '@cursor-accounts/types';
import { EfficiencyDatabase } from '../../persistence/efficiencyDatabase';
import type { PromptEventRecord } from '../../persistence/types';

const extensionPath = path.join(__dirname, '..', '..', '..');

function makeEvent(
  profileId: string,
  overrides: Partial<PromptEventRecord> = {}
): PromptEventRecord {
  return {
    profileId,
    timestamp: Date.now(),
    promptText: 'What is the capital of Spain?',
    modelUsed: 'claude-4-sonnet',
    efficiencyScore: 0.85,
    severity: 'low',
    confidence: 0.9,
    taskType: 'factual_simple',
    repositoryPath: '/repo/web-app',
    branchName: 'main',
    conversationId: 'conv-1',
    scoredAt: Date.now(),
    requiredTier: 1,
    actualTier: 2,
    recommendedModel: 'auto',
    opinion: 'Oversized model',
    quotaPercentUsed: 25,
    quotaLimit: 40000,
    quotaRemaining: 30000,
    quotaCycleStart: 1_700_000_000,
    quotaCycleEnd: 1_702_000_000,
    quotaIsEnterprise: false,
    ...overrides,
  };
}

describe('EfficiencyDatabase', () => {
  let tempDir = '';

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('initializes and inserts events with aggregated stats', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-db-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const db = new EfficiencyDatabase(dbPath, extensionPath);
    await db.initialize();

    await db.insertEvent(makeEvent('profile-1'));
    await db.insertEvent(
      makeEvent('profile-1', {
        efficiencyScore: 0.4,
        branchName: 'feature/auth',
      })
    );
    await db.insertEvent(
      makeEvent('profile-1', {
        repositoryPath: '/repo/mobile-app',
        branchName: 'develop',
      })
    );

    const stats = await db.getAggregatedStats('profile-1');
    assert.equal(stats.totalPrompts, 3);
    assert.equal(stats.efficientPrompts, 2);
    assert.equal(stats.inefficientPrompts, 1);

    const webApp = stats.byRepository['/repo/web-app'];
    assert.ok(webApp);
    assert.equal(webApp.totalPrompts, 2);
    assert.ok(webApp.byBranch.main);
    assert.ok(webApp.byBranch['feature/auth']);

    const mobile = stats.byRepository['/repo/mobile-app'];
    assert.ok(mobile?.byBranch.develop);
  });

  it('queries efficiency by quota range', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-db-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const db = new EfficiencyDatabase(dbPath, extensionPath);
    await db.initialize();

    await db.insertEvent(
      makeEvent('profile-1', { quotaPercentUsed: 10, efficiencyScore: 0.9 })
    );
    await db.insertEvent(
      makeEvent('profile-1', { quotaPercentUsed: 80, efficiencyScore: 0.5 })
    );

    const start = await db.getEfficiencyByQuotaRange('profile-1', 0, 33);
    assert.equal(start.count, 1);
    assert.ok(start.avgEfficiency >= EFFICIENCY_SCORE_THRESHOLD);

    const end = await db.getEfficiencyByQuotaRange('profile-1', 67, 100);
    assert.equal(end.count,  1);
    assert.ok(end.avgEfficiency < EFFICIENCY_SCORE_THRESHOLD);
  });

  it('reads repository, branch, quota-phase, and trend projections', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-db-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const db = new EfficiencyDatabase(dbPath, extensionPath);
    await db.initialize();

    const now = Math.floor(Date.now() / 1000);
    await db.insertEvent(
      makeEvent('profile-1', {
        timestamp: (now - 3) * 1000,
        scoredAt: (now - 3) * 1000,
        quotaPercentUsed: 10,
      })
    );
    await db.insertEvent(
      makeEvent('profile-1', {
        timestamp: (now - 2) * 1000,
        scoredAt: (now - 2) * 1000,
        quotaPercentUsed: 50,
        branchName: 'feature/auth',
      })
    );
    await db.insertEvent(
      makeEvent('profile-1', {
        timestamp: (now - 1) * 1000,
        scoredAt: (now - 1) * 1000,
        quotaPercentUsed: 80,
        repositoryPath: '/repo/mobile-app',
        branchName: 'develop',
      })
    );

    assert.equal((await db.getEventsByRepository('profile-1', '/repo/web-app')).length, 2);
    assert.equal(
      (await db.getEventsByBranch('profile-1', '/repo/web-app', 'main')).length,
      1
    );
    assert.equal(
      (
        await db.getEventsWithQuota('profile-1', {
          fromTimestamp: now - 3,
          toTimestamp: now,
          limit: 2,
        })
      ).length,
      2
    );
    assert.equal((await db.getEventsByQuotaPhase('profile-1', 'start')).length, 1);
    assert.equal((await db.getEventsByQuotaPhase('profile-1', 'mid')).length, 1);
    assert.equal((await db.getEventsByQuotaPhase('profile-1', 'end')).length, 1);

    const trend = await db.getEfficiencyTrendByQuota('profile-1', 10);
    assert.deepEqual(
      trend.map((bucket) => bucket.quotaBucket),
      [10, 50, 80]
    );
    assert.ok(trend.every((bucket) => bucket.count === 1));
  });

  it('deletes old events and vacuums', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-db-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const db = new EfficiencyDatabase(dbPath, extensionPath);
    await db.initialize();

    const oldTs = Math.floor(Date.now() / 1000) - 100 * 24 * 60 * 60;
    await db.insertEvent(
      makeEvent('profile-1', { timestamp: oldTs * 1000, scoredAt: oldTs * 1000 })
    );
    await db.insertEvent(makeEvent('profile-1'));

    const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60;
    const removed = await db.deleteOldEvents('profile-1', cutoff);
    assert.equal(removed, 1);

    const stats = await db.getAggregatedStats('profile-1');
    assert.equal(stats.totalPrompts, 1);

    await db.vacuum();
    const size = await db.getDatabaseSize();
    assert.ok(size > 0);
  });

  it('preserves database sidecars when recreating a failed database', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-db-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    await fs.writeFile(dbPath, 'corrupted database marker');
    await fs.writeFile(`${dbPath}-wal`, 'uncheckpointed WAL marker');
    await fs.writeFile(`${dbPath}-shm`, 'shared memory marker');

    const db = new EfficiencyDatabase(dbPath, extensionPath);
    await (db as unknown as { fallbackRecreate(): Promise<void> }).fallbackRecreate();

    const entries = await fs.readdir(tempDir);
    const backupName = entries.find((name) => /^efficiency\.db\.corrupted-\d+$/.test(name));
    assert.ok(backupName);
    assert.equal(
      await fs.readFile(path.join(tempDir, `${backupName}-wal`), 'utf8'),
      'uncheckpointed WAL marker'
    );
    assert.equal(
      await fs.readFile(path.join(tempDir, `${backupName}-shm`), 'utf8'),
      'shared memory marker'
    );
    assert.equal(await fs.stat(dbPath).then((stat) => stat.isFile()), true);
  });
});
