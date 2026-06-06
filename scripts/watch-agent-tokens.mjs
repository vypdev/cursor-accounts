#!/usr/bin/env node
/**
 * Watch agent_tokens / agents while testing live proxy traffic.
 *
 * Usage:
 *   node scripts/watch-agent-tokens.mjs [profile-suffix]
 *   node scripts/watch-agent-tokens.mjs efraespada_gmail_com
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const profileSuffix = process.argv[2] ?? 'efraespada_gmail_com';
const dbPath = path.join(
  os.homedir(),
  `.cursor-${profileSuffix}`,
  'User',
  'globalStorage',
  'cursor-accounts-efficiency.db'
);

if (!fs.existsSync(dbPath)) {
  console.error(`DB not found: ${dbPath}`);
  process.exit(1);
}

function query(sql) {
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  return execSync(
    `sqlite3 -separator '|' ${JSON.stringify(dbPath)} ${JSON.stringify(oneLine)}`,
    { encoding: 'utf8' }
  ).trim();
}

function snapshot() {
  const counts = query(
    "SELECT 'agents' AS k, COUNT(*) FROM agents UNION ALL SELECT 'agent_tokens', COUNT(*) FROM agent_tokens UNION ALL SELECT 'turn_ended', COUNT(*) FROM agent_turn_ended"
  );

  const latestTokens = query(
    'SELECT request_id, minute_bucket, streaming_tokens, cost_cents, model_name FROM agent_tokens ORDER BY recorded_at DESC LIMIT 3'
  );

  const latestAgents = query(
    'SELECT request_id, conversation_id, model_name FROM agents ORDER BY started_at DESC LIMIT 3'
  );

  return { counts, latestTokens, latestAgents };
}

let prev = snapshot();
console.log(`Watching ${dbPath}`);
console.log('Send an Agent prompt in Cursor. Ctrl+C to stop.\n');
console.log('Initial:', prev.counts.replace(/\n/g, ' | '));

setInterval(() => {
  const next = snapshot();
  if (next.counts !== prev.counts || next.latestTokens !== prev.latestTokens) {
    console.log(`\n[${new Date().toISOString()}] CHANGE`);
    console.log('Counts:', next.counts.replace(/\n/g, ' | '));
    if (next.latestTokens) {
      console.log('Latest agent_tokens:');
      for (const line of next.latestTokens.split('\n')) {
        const [rid, bucket, tokens, cost, model] = line.split('|');
        console.log(`  ${rid?.slice(0, 8)}… bucket=${bucket} tokens=${tokens} cost=${cost ?? '-'} model=${model ?? '-'}`);
      }
    }
    if (next.latestAgents) {
      console.log('Latest agents:');
      for (const line of next.latestAgents.split('\n')) {
        const [rid, conv, model] = line.split('|');
        console.log(`  bidi=${rid?.slice(0, 8)}… conv=${conv?.slice(0, 8)}… model=${model ?? '-'}`);
      }
    }
    prev = next;
  }
}, 2000);
