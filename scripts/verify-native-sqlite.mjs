#!/usr/bin/env node
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const runtime = process.argv.includes('--runtime')
  ? process.argv[process.argv.indexOf('--runtime') + 1]
  : 'node';

if (runtime !== 'node') {
  throw new Error(
    `This smoke test currently validates the Node binding only; received runtime "${runtime}".`
  );
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-accounts-native-sqlite-'));
const databasePath = path.join(tempDir, 'smoke.sqlite');
let database;

try {
  database = new Database(databasePath, { timeout: 5_000 });
  database.pragma('journal_mode = WAL');
  database.pragma('busy_timeout = 5000');
  database.pragma('foreign_keys = ON');

  const result = {
    runtime,
    nodeVersion: process.version,
    nodeModuleVersion: process.versions.modules,
    sqliteVersion: database.prepare('SELECT sqlite_version() AS version').get().version,
    journalMode: database.pragma('journal_mode', { simple: true }),
    busyTimeout: database.pragma('busy_timeout', { simple: true }),
    foreignKeys: database.pragma('foreign_keys', { simple: true }),
  };

  if (String(result.journalMode).toLowerCase() !== 'wal') {
    throw new Error(`Expected WAL journal mode, received ${String(result.journalMode)}`);
  }
  if (Number(result.busyTimeout) !== 5_000) {
    throw new Error(`Expected busy_timeout=5000, received ${String(result.busyTimeout)}`);
  }
  if (Number(result.foreignKeys) !== 1) {
    throw new Error(`Expected foreign_keys=1, received ${String(result.foreignKeys)}`);
  }

  console.log(JSON.stringify(result, null, 2));
} finally {
  database?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
