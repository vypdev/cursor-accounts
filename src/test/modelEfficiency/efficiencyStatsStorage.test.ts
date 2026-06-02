import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  EFFICIENCY_STATS_FILENAME,
  EfficiencyStatsStorage,
} from '../../modelEfficiency/efficiencyStatsStorage';
import type { Profile } from '../../profiles/types';

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

describe('EfficiencyStatsStorage', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('records account, repository, and branch stats', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-stats-'));
    const profile = makeProfile(tempDir);
    const storage = new EfficiencyStatsStorage();

    await storage.recordAnalysis(profile, 0.85, '/repo/web-app', 'main');
    await storage.recordAnalysis(profile, 0.4, '/repo/web-app', 'feature/auth');
    await storage.recordAnalysis(profile, 0.9, '/repo/mobile-app', 'develop');

    const stats = storage.getStats(profile.id);
    assert.ok(stats);
    assert.equal(stats.totalPrompts, 3);
    assert.equal(stats.efficientPrompts, 2);
    assert.equal(stats.inefficientPrompts, 1);

    const webApp = stats.byRepository['/repo/web-app'];
    assert.ok(webApp);
    assert.equal(webApp.totalPrompts, 2);
    assert.ok(webApp.byBranch.main);
    assert.equal(webApp.byBranch.main.totalPrompts, 1);
    assert.ok(webApp.byBranch['feature/auth']);
    assert.equal(webApp.byBranch['feature/auth'].inefficientPrompts, 1);

    const statsPath = path.join(
      tempDir,
      'User',
      'globalStorage',
      EFFICIENCY_STATS_FILENAME
    );
    const raw = await fs.readFile(statsPath, 'utf-8');
    const persisted = JSON.parse(raw) as { totalPrompts: number };
    assert.equal(persisted.totalPrompts, 3);
  });

  it('loads persisted stats on startup', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-stats-'));
    const profile = makeProfile(tempDir);
    const writer = new EfficiencyStatsStorage();
    await writer.recordAnalysis(profile, 0.8, '/repo/web-app', 'main');

    const reader = new EfficiencyStatsStorage();
    const loaded = await reader.loadStats(profile);
    assert.ok(loaded);
    assert.equal(loaded.totalPrompts, 1);
    const repo = loaded.byRepository['/repo/web-app'];
    assert.ok(repo?.byBranch.main);
    assert.equal(repo.byBranch.main.totalPrompts, 1);
  });

  it('deletes stats file', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-stats-'));
    const profile = makeProfile(tempDir);
    const storage = new EfficiencyStatsStorage();
    await storage.recordAnalysis(profile, 0.8, '/repo/web-app', 'main');
    await storage.deleteStats(profile);

    const statsPath = path.join(
      tempDir,
      'User',
      'globalStorage',
      EFFICIENCY_STATS_FILENAME
    );
    await assert.rejects(() => fs.access(statsPath));
    assert.equal(storage.getStats(profile.id), undefined);
  });
});
