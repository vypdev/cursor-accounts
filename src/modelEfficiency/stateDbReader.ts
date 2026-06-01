import { execFileSync } from 'child_process';
import * as fs from 'fs/promises';
import { validateStateDbPath, parseStoredValue } from '../auth/tokenReader';
import { getSqlite3Binary } from '../auth/sqliteBinary';
import * as extensionLog from '../logging/extensionLog';

export const COMPOSER_HEADERS_KEY = 'composer.composerHeaders';

export const APPLICATION_USER_KEY =
  'src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser';

export type StateDbTable = 'ItemTable' | 'cursorDiskKV';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 50;

function isBusyError(error: unknown): boolean {
  const message = extensionLog.formatError(error);
  return (
    message.includes('database is locked') ||
    message.includes('SQLITE_BUSY') ||
    message.includes('locked')
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function queryValue(
  dbPath: string,
  table: StateDbTable,
  key: string,
  extensionPath: string
): string | undefined {
  const escapedKey = key.replace(/'/g, "''");
  const sql = `SELECT CAST(value AS TEXT) FROM ${table} WHERE key = '${escapedKey}' LIMIT 1;`;
  const args = ['-readonly', dbPath, sql];

  const output = execFileSync(getSqlite3Binary(extensionPath), args, {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return parseStoredValue(output.trim() || undefined);
}

async function readWithRetry(
  dbPath: string,
  table: StateDbTable,
  key: string,
  extensionPath: string
): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const value = queryValue(dbPath, table, key, extensionPath);
      return value ?? null;
    } catch (error) {
      if (isBusyError(error) && attempt < MAX_RETRIES - 1) {
        await delay(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
  return null;
}

export async function readItemTableKey(
  dbPath: string,
  key: string,
  extensionPath: string
): Promise<string | null> {
  validateStateDbPath(dbPath);
  try {
    await fs.access(dbPath, fs.constants.R_OK);
  } catch {
    return null;
  }

  try {
    return await readWithRetry(dbPath, 'ItemTable', key, extensionPath);
  } catch (error) {
    extensionLog.debug(
      `[StateDbReader] ItemTable read failed for ${key}: ${extensionLog.formatError(error)}`
    );
    return null;
  }
}

export async function readCursorDiskKV(
  dbPath: string,
  key: string,
  extensionPath: string
): Promise<string | null> {
  validateStateDbPath(dbPath);
  try {
    await fs.access(dbPath, fs.constants.R_OK);
  } catch {
    return null;
  }

  try {
    return await readWithRetry(dbPath, 'cursorDiskKV', key, extensionPath);
  } catch (error) {
    extensionLog.debug(
      `[StateDbReader] cursorDiskKV read failed for ${key}: ${extensionLog.formatError(error)}`
    );
    return null;
  }
}

export function composerDataKey(composerId: string): string {
  return `composerData:${composerId}`;
}

export function bubbleIdKey(composerId: string, bubbleId: string): string {
  return `bubbleId:${composerId}:${bubbleId}`;
}
