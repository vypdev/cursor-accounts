import { execFileSync } from 'child_process';
import * as fs from 'fs/promises';
import type { CursorAuthTokens } from '@cursor-accounts/types';
import { CURSOR_AUTH_KEYS } from './cursorPaths';
import { getSqlite3Binary } from './sqliteBinary';
import { validateStateDbPath } from '../utils/pathUtils';

/** Strip JSON-encoded string values from VS Code SQLite ItemTable. */
export function parseStoredValue(raw: string | null | undefined): string | undefined {
  if (raw == null || raw === '') {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function readKeyFromDb(
  dbPath: string,
  key: string,
  extensionPath: string
): string | undefined {
  const escapedKey = key.replace(/'/g, "''");
  const sql = `SELECT value FROM ItemTable WHERE key = '${escapedKey}' LIMIT 1;`;
  const args = ['-readonly', dbPath, sql];

  const output = execFileSync(getSqlite3Binary(extensionPath), args, {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return parseStoredValue(output.trim() || undefined);
}

/**
 * Read authentication tokens from a specific state.vscdb file.
 *
 * @param stateDbPath Absolute path to state.vscdb
 * @param extensionPath Extension path (used to locate bundled sqlite3 binary)
 */
export async function readAuthFromStateDb(
  stateDbPath: string,
  extensionPath: string
): Promise<CursorAuthTokens | null> {
  validateStateDbPath(stateDbPath);

  try {
    await fs.access(stateDbPath, fs.constants.R_OK);
  } catch {
    return null;
  }

  try {
    const accessToken = readKeyFromDb(
      stateDbPath,
      CURSOR_AUTH_KEYS.accessToken,
      extensionPath
    );
    if (!accessToken) {
      return null;
    }

    return {
      accessToken,
      refreshToken: readKeyFromDb(
        stateDbPath,
        CURSOR_AUTH_KEYS.refreshToken,
        extensionPath
      ),
      email: readKeyFromDb(
        stateDbPath,
        CURSOR_AUTH_KEYS.cachedEmail,
        extensionPath
      ),
    };
  } catch {
    return null;
  }
}

/** Decode JWT payload without verification (exp check only). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isTokenExpired(
  token: string,
  skewSeconds = 60
): boolean {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  if (typeof exp !== 'number') {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  return exp <= now + skewSeconds;
}
