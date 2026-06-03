#!/usr/bin/env node
/**
 * Analyze MITM proxy JSONL logs with proto decode + insight extraction.
 *
 * Usage:
 *   node scripts/analyze-proxy-traffic.mjs [log-dir]
 *   pnpm run analyze:proxy-traffic
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';
import { bodyBufferFromEntry } from './lib/proxy-log-body.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PROTO_FILES = [
  path.join(REPO_ROOT, 'proto', 'agent', 'v1', 'agent.proto'),
  path.join(REPO_ROOT, 'proto', 'aiserver', 'v1', 'aiserver.proto'),
];

const DEFAULT_LOG_DIR = path.join(
  process.env.HOME ?? '',
  '.cursor-accounts',
  'proxy',
  'logs'
);

const RPC_PATH_RE =
  /\/(aiserver\.v1\.[A-Za-z0-9_]+Service)\/([A-Za-z0-9_]+)/;

function connectPayloadCandidates(body) {
  const candidates = [body];
  if (body.length >= 5 && body[0] === 0) {
    const len = body.readUInt32BE(1);
    if (body.length >= 5 + len) {
      candidates.push(body.subarray(5, 5 + len));
    }
  }
  return [...new Set(candidates.map((b) => b.toString('hex')))].map((hex) =>
    Buffer.from(hex, 'hex')
  );
}

function tryDecode(Type, raw) {
  for (const payload of connectPayloadCandidates(raw)) {
    try {
      const msg = Type.decode(payload);
      return Type.toObject(msg, {
        longs: String,
        enums: String,
        bytes: String,
        defaults: false,
      });
    } catch {
      // continue
    }
  }
  return null;
}

function extractBilling(decoded) {
  if (!decoded) return null;
  return {
    billingCycleStart: decoded.billing_cycle_start,
    billingCycleEnd: decoded.billing_cycle_end,
    planUsage: decoded.plan_usage,
    spendLimit: decoded.spend_limit_usage,
  };
}

function extractTokens(decoded) {
  const usage =
    decoded?.metadata?.token_usage ??
    decoded?.token_usage ??
    decoded?.usage;
  if (!usage) return null;
  return {
    modelName: decoded?.metadata?.model_name ?? decoded?.model_name,
    ...usage,
  };
}

function parseRpc(url) {
  const m = String(url).match(RPC_PATH_RE);
  if (!m) return null;
  return { path: `/${m[1]}/${m[2]}`, method: m[2] };
}

async function main() {
  const logDir = path.resolve(process.argv[2] ?? DEFAULT_LOG_DIR);
  if (!fs.existsSync(logDir)) {
    console.error(`Log dir not found: ${logDir}`);
    process.exit(1);
  }

  const root = await protobuf.load(PROTO_FILES);
  const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.jsonl'));

  let total = 0;
  let decoded = 0;
  let insights = 0;
  /** @type {Map<string, number>} */
  const byMethod = new Map();

  for (const file of files) {
    for (const line of fs.readFileSync(path.join(logDir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.direction !== 'request' && entry.direction !== 'response') {
        continue;
      }

      const rpc = parseRpc(entry.url ?? '');
      if (!rpc) continue;

      total++;
      const typeName = `aiserver.v1.${rpc.method}${entry.direction === 'request' ? 'Request' : 'Response'}`;

      let Type;
      try {
        Type = root.lookupType(typeName);
      } catch {
        continue;
      }

      const ct = (entry.headers?.['content-type'] ?? '').toLowerCase();
      let obj = null;

      if (ct.includes('json') && entry.body) {
        try {
          obj = JSON.parse(entry.body);
        } catch {
          // skip
        }
      } else {
        const raw = bodyBufferFromEntry(entry);
        if (raw) {
          obj = tryDecode(Type, raw);
        }
      }

      if (!obj) continue;
      decoded++;

      const key = `${rpc.method}:${entry.direction}`;
      byMethod.set(key, (byMethod.get(key) ?? 0) + 1);

      const billing = extractBilling(obj);
      const tokens = extractTokens(obj);
      if (billing || tokens) {
        insights++;
        if (insights <= 15) {
          console.log(`\n## ${key} (${file})`);
          if (billing) console.log('  billing:', JSON.stringify(billing).slice(0, 200));
          if (tokens) console.log('  tokens:', JSON.stringify(tokens).slice(0, 200));
        }
      }
    }
  }

  console.log(`\nFiles: ${files.length}`);
  console.log(`Entries (aiserver req/resp): ${total}`);
  console.log(`Decoded: ${decoded}`);
  console.log(`With insights: ${insights}`);
  console.log('\nTop decoded methods:');
  for (const [k, n] of [...byMethod.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${k}: ${n}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
