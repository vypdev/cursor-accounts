import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  COMPOSER_HEADERS_KEY,
  composerDataKey,
  bubbleIdKey,
  readCursorDiskKV,
  readItemTableKey,
} from '../../modelEfficiency/stateDbReader';

const extensionPath = path.join(__dirname, '..', '..', '..');

function runSqlite(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf8' });
}

async function createFixtureDb(dir: string): Promise<string> {
  const dbPath = path.join(dir, 'state.vscdb');
  runSqlite(
    dbPath,
    `CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
     CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);`
  );

  const headers = JSON.stringify({
    allComposers: [
      {
        composerId: 'composer-1',
        lastUpdatedAt: 1_000_000,
        trackedGitRepos: [{ repoPath: '/tmp/project' }],
      },
    ],
  });
  runSqlite(
    dbPath,
    `INSERT INTO ItemTable (key, value) VALUES ('${COMPOSER_HEADERS_KEY}', '${headers.replace(/'/g, "''")}');`
  );

  const composerData = JSON.stringify({
    composerId: 'composer-1',
    modelConfig: { modelName: 'claude-opus-4' },
    fullConversationHeadersOnly: [
      { bubbleId: 'bubble-user-1', type: 1 },
      { bubbleId: 'bubble-ai-1', type: 2 },
    ],
  });
  runSqlite(
    dbPath,
    `INSERT INTO cursorDiskKV (key, value) VALUES ('${composerDataKey('composer-1').replace(/'/g, "''")}', '${composerData.replace(/'/g, "''")}');`
  );

  const bubble = JSON.stringify({
    type: 1,
    text: 'What is the capital of Spain?',
    createdAt: '2026-05-29T12:00:00.000Z',
    bubbleId: 'bubble-user-1',
  });
  runSqlite(
    dbPath,
    `INSERT INTO cursorDiskKV (key, value) VALUES ('${bubbleIdKey('composer-1', 'bubble-user-1').replace(/'/g, "''")}', '${bubble.replace(/'/g, "''")}');`
  );

  return dbPath;
}

describe('stateDbReader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.homedir(), '.cursor-accounts-test-state-db-')
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('readItemTableKey returns composer headers JSON', async () => {
    const dbPath = await createFixtureDb(tempDir);
    const raw = await readItemTableKey(
      dbPath,
      COMPOSER_HEADERS_KEY,
      extensionPath
    );
    assert.ok(raw);
    const parsed = JSON.parse(raw) as {
      allComposers: Array<{ composerId: string }>;
    };
    assert.equal(parsed.allComposers[0].composerId, 'composer-1');
  });

  it('readCursorDiskKV returns composerData and bubble rows', async () => {
    const dbPath = await createFixtureDb(tempDir);
    const dataRaw = await readCursorDiskKV(
      dbPath,
      composerDataKey('composer-1'),
      extensionPath
    );
    assert.ok(dataRaw);
    const data = JSON.parse(dataRaw) as { modelConfig: { modelName: string } };
    assert.equal(data.modelConfig.modelName, 'claude-opus-4');

    const bubbleRaw = await readCursorDiskKV(
      dbPath,
      bubbleIdKey('composer-1', 'bubble-user-1'),
      extensionPath
    );
    assert.ok(bubbleRaw);
    const bubble = JSON.parse(bubbleRaw) as { text: string; type: number };
    assert.equal(bubble.type, 1);
    assert.match(bubble.text, /Spain/);
  });

  it('returns null for missing database file', async () => {
    const missing = path.join(tempDir, 'missing.vscdb');
    const value = await readItemTableKey(
      missing,
      COMPOSER_HEADERS_KEY,
      extensionPath
    );
    assert.equal(value, null);
  });
});
