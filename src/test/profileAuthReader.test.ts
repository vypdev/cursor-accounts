import './registerVscodeMock';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ProfileAuthReader } from '../auth/profileAuthReader';
import { CURSOR_AUTH_KEYS } from '../auth/cursorPaths';
import { getSqlite3Binary } from '../auth/sqliteBinary';

const extensionPath = path.join(__dirname, '..', '..');

function runSqlite(dbPath: string, sql: string): void {
  execFileSync(getSqlite3Binary(extensionPath), [dbPath, sql], {
    encoding: 'utf8',
  });
}

async function createAuthDb(dir: string): Promise<string> {
  const userDataDir = path.join(dir, 'profile-auth');
  const stateDbPath = path.join(
    userDataDir,
    'User',
    'globalStorage',
    'state.vscdb'
  );
  await fs.mkdir(path.dirname(stateDbPath), { recursive: true });
  runSqlite(
    stateDbPath,
    `CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);`
  );

  const accessToken = JSON.stringify('test-access-token');
  const refreshToken = JSON.stringify('test-refresh-token');
  const email = JSON.stringify('reader@example.com');

  runSqlite(
    stateDbPath,
    `INSERT INTO ItemTable (key, value) VALUES ('${CURSOR_AUTH_KEYS.accessToken}', '${accessToken.replace(/'/g, "''")}');
     INSERT INTO ItemTable (key, value) VALUES ('${CURSOR_AUTH_KEYS.refreshToken}', '${refreshToken.replace(/'/g, "''")}');
     INSERT INTO ItemTable (key, value) VALUES ('${CURSOR_AUTH_KEYS.cachedEmail}', '${email.replace(/'/g, "''")}');`
  );

  return userDataDir;
}

describe('ProfileAuthReader', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(extensionPath, '.tmp-auth-reader-')
    );
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('reads tokens from profile state.vscdb', async () => {
    const userDataDir = await createAuthDb(tempDir);
    const reader = new ProfileAuthReader({
      extensionPath,
    } as never);

    const tokens = await reader.readTokens(userDataDir);

    assert.ok(tokens);
    assert.equal(tokens?.accessToken, 'test-access-token');
    assert.equal(tokens?.refreshToken, 'test-refresh-token');
    assert.equal(tokens?.email, 'reader@example.com');
  });

  it('returns null when state database is missing', async () => {
    const userDataDir = path.join(tempDir, 'missing-profile');
    const reader = new ProfileAuthReader({
      extensionPath,
    } as never);

    const tokens = await reader.readTokens(userDataDir);
    assert.equal(tokens, null);
  });
});
