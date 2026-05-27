import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { CursorAuthTokens } from '../api/types';
import {
  CURSOR_AUTH_KEYS,
  getCursorStateDbPath,
} from './cursorPaths';
import { getSqlite3Binary } from './sqliteBinary';

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

export function readAuthFromStateDb(extensionPath: string): CursorAuthTokens | null {
  const dbPath = getCursorStateDbPath();
  if (!fs.existsSync(dbPath)) {
    return null;
  }

  try {
    const accessToken = readKeyFromDb(
      dbPath,
      CURSOR_AUTH_KEYS.accessToken,
      extensionPath
    );
    if (!accessToken) {
      return null;
    }

    return {
      accessToken,
      refreshToken: readKeyFromDb(
        dbPath,
        CURSOR_AUTH_KEYS.refreshToken,
        extensionPath
      ),
      email: readKeyFromDb(
        dbPath,
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
  if (parts.length < 2) {
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
