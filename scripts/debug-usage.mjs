#!/usr/bin/env node
/**
 * Debug Cursor usage APIs for a profile user-data directory.
 *
 * Usage:
 *   node scripts/debug-usage.mjs --user-data-dir ~/.cursor-efrain_espada_feverup_com
 *   node scripts/debug-usage.mjs --email efrain.espada@feverup.com
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { userDataDir: undefined, email: undefined };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--user-data-dir' && argv[i + 1]) {
      args.userDataDir = argv[++i].replace(/^~/, os.homedir());
    } else if (argv[i] === '--email' && argv[i + 1]) {
      args.email = argv[++i];
    }
  }
  return args;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveUserDataDir({ userDataDir, email }) {
  if (userDataDir) {
    return path.resolve(userDataDir);
  }

  const configPath = path.join(os.homedir(), '.cursor-accounts', 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      'Provide --user-data-dir or ensure ~/.cursor-accounts/config.json exists'
    );
  }

  const config = readJsonFile(configPath);
  if (email) {
    const profile = config.profiles?.find(
      (p) => p.email?.toLowerCase() === email.toLowerCase()
    );
    if (!profile?.userDataDir) {
      throw new Error(`No profile found for email: ${email}`);
    }
    return profile.userDataDir;
  }

  if (config.profiles?.length === 1) {
    return config.profiles[0].userDataDir;
  }

  throw new Error(
    'Multiple profiles found. Pass --user-data-dir or --email <address>'
  );
}

function sqliteBinary() {
  const platform = `${process.platform}-${process.arch}`;
  const bin =
    platform === 'darwin-arm64'
      ? path.join(repoRoot, 'bin', 'darwin-arm64', 'sqlite3')
      : path.join(repoRoot, 'bin', 'darwin-x64', 'sqlite3');
  if (fs.existsSync(bin)) {
    return bin;
  }
  return 'sqlite3';
}

function readDbKey(dbPath, key) {
  const escapedKey = key.replace(/'/g, "''");
  const sql = `SELECT value FROM ItemTable WHERE key = '${escapedKey}' LIMIT 1;`;
  const raw = execFileSync(sqliteBinary(), ['-readonly', dbPath, sql], {
    encoding: 'utf8',
  }).trim();
  if (!raw) {
    return undefined;
  }
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

function decodeJwtPayload(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function buildWorkosSessionCookie(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  const sub = payload.sub;
  const userId = sub.includes('|') ? sub.split('|').pop() : sub;
  return `WorkosCursorSessionToken=${userId}%3A%3A${accessToken}`;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function main() {
  const args = parseArgs(process.argv);
  const userDataDir = resolveUserDataDir(args);
  const dbPath = path.join(userDataDir, 'User', 'globalStorage', 'state.vscdb');

  if (!fs.existsSync(dbPath)) {
    throw new Error(`state.vscdb not found: ${dbPath}`);
  }

  const accessToken = readDbKey(dbPath, 'cursorAuth/accessToken');
  const email = readDbKey(dbPath, 'cursorAuth/cachedEmail');
  const membership = readDbKey(dbPath, 'cursorAuth/stripeMembershipType');

  if (!accessToken) {
    throw new Error('No cursorAuth/accessToken in profile database');
  }

  const payload = decodeJwtPayload(accessToken);
  const userId = payload.sub?.includes('|')
    ? payload.sub.split('|').pop()
    : payload.sub;

  console.log('Profile userDataDir:', userDataDir);
  console.log('Email:', email);
  console.log('stripeMembershipType:', membership);
  console.log('userId:', userId);
  console.log('token exp:', payload.exp ? new Date(payload.exp * 1000).toISOString() : 'unknown');

  const cookie = buildWorkosSessionCookie(accessToken);

  const summary = await fetchJson('https://cursor.com/api/usage-summary', {
    headers: { Cookie: cookie, Accept: 'application/json' },
  });
  console.log('\n=== usage-summary', summary.status, '===');
  console.log(JSON.stringify(summary.body, null, 2));

  const ide = await fetchJson(
    'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
      },
      body: '{}',
    }
  );
  console.log('\n=== GetCurrentPeriodUsage', ide.status, '===');
  console.log(JSON.stringify(ide.body, null, 2));

  const { mapUsageSummaryResponse } = await import(
    path.join(repoRoot, 'out', 'api', 'usageSummaryClient.js')
  );
  if (summary.status === 200 && typeof summary.body === 'object') {
    const mapped = mapUsageSummaryResponse(summary.body, email);
    console.log('\n=== mapUsageSummaryResponse ===');
    console.log(JSON.stringify(mapped, null, 2));
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
