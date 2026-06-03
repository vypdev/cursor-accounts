#!/usr/bin/env node
/**
 * Smoke-test extracted aiserver.proto:
 * 1) Load with protobufjs (schema resolve)
 * 2) Decode Connect envelope payloads from proxy logs or fixtures
 *
 * Usage: node scripts/test-proto-decode.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PROTO_ROOT = path.join(REPO_ROOT, 'proto');
const PROTO_FILES = [
  path.join(PROTO_ROOT, 'agent', 'v1', 'agent.proto'),
  path.join(PROTO_ROOT, 'aiserver', 'v1', 'aiserver.proto'),
];

/**
 * @param {Buffer} body
 * @returns {Buffer[]}
 */
function connectPayloadCandidates(body) {
  const candidates = [body];
  if (body.length >= 5 && body[0] === 0) {
    const len = body.readUInt32BE(1);
    if (body.length >= 5 + len) {
      candidates.push(body.subarray(5, 5 + len));
    }
  }
  if (body.length >= 3 && body[0] === 0) {
    const len = body.readUInt16BE(1);
    if (body.length >= 3 + len) {
      candidates.push(body.subarray(3, 3 + len));
    }
  }
  return [...new Set(candidates)];
}

/**
 * @param {protobuf.Type} Type
 * @param {Buffer} raw
 */
function tryDecode(Type, raw) {
  for (const payload of connectPayloadCandidates(raw)) {
    try {
      return decodeJson(Type, payload);
    } catch {
      // try next framing
    }
  }
  throw new Error(`Could not decode ${Type.name} (${raw.length} bytes)`);
}

/** @param {protobuf.Type} Type */
function decodeJson(Type, payload) {
  const msg = Type.decode(payload);
  return Type.toObject(msg, {
    longs: String,
    enums: String,
    bytes: String,
    defaults: true,
  });
}

async function loadSchema() {
  for (const file of PROTO_FILES) {
    if (!fs.existsSync(file)) {
      throw new Error(`Missing ${file} — run pnpm run extract:protos`);
    }
  }
  const root = await protobuf.load(PROTO_FILES);
  const checks = [
    'aiserver.v1.GetCurrentPeriodUsageResponse',
    'aiserver.v1.GetUsageLimitStatusAndActiveGrantsResponse',
    'aiserver.v1.GetTokenUsageResponse',
    'aiserver.v1.AcquireResponse',
  ];
  for (const name of checks) {
    root.lookupType(name);
  }
  return root;
}

async function decodeFromProxyLogs(root) {
  const logDir = path.join(
    process.env.HOME ?? '',
    '.cursor-accounts',
    'proxy',
    'logs'
  );
  if (!fs.existsSync(logDir)) {
    console.log('No proxy logs dir, skipping live decode');
    return;
  }

  const targets = [
    {
      urlPart: 'GetUsageLimitStatusAndActiveGrants',
      type: 'aiserver.v1.GetUsageLimitStatusAndActiveGrantsResponse',
    },
    {
      urlPart: 'GetCurrentPeriodUsage',
      type: 'aiserver.v1.GetCurrentPeriodUsageResponse',
      json: true,
    },
  ];

  for (const target of targets) {
    for (const file of fs.readdirSync(logDir).sort().reverse()) {
      if (!file.endsWith('.jsonl')) continue;
      const lines = fs.readFileSync(path.join(logDir, file), 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (
          entry.direction !== 'response' ||
          !String(entry.url ?? '').includes(target.urlPart)
        ) {
          continue;
        }
        const ct = entry.headers?.['content-type'] ?? '';
        if (target.json) {
          if (!ct.includes('json') || !entry.body) continue;
          console.log(`\n--- ${target.urlPart} (JSON from ${file}) ---`);
          console.log(JSON.stringify(JSON.parse(entry.body), null, 2).slice(0, 1200));
          break;
        }
        if (!ct.includes('proto') || !entry.body) continue;
        const raw = Buffer.from(entry.body, 'latin1');
        const Type = root.lookupType(target.type);
        console.log(`\n--- ${target.urlPart} (proto ${raw.length}b from ${file}) ---`);
        console.log(JSON.stringify(tryDecode(Type, raw), null, 2));
        break;
      }
    }
  }
}

async function main() {
  console.log('Loading', PROTO_FILES.join(', '));
  const root = await loadSchema();
  console.log('Schema OK — resolved key message types');

  const fixture = path.join(REPO_ROOT, '.tmp-proto-test', 'sample.bin');
  if (fs.existsSync(fixture)) {
    const raw = fs.readFileSync(fixture);
    const Type = root.lookupType(
      'aiserver.v1.GetUsageLimitStatusAndActiveGrantsResponse'
    );
    console.log('\n--- Fixture GetUsageLimitStatusAndActiveGrantsResponse ---');
    console.log(JSON.stringify(tryDecode(Type, raw), null, 2));
  }

  await decodeFromProxyLogs(root);
  console.log('\nAll proto smoke checks passed.');
}

main().catch((err) => {
  console.error('Proto test failed:', err.message ?? err);
  process.exit(1);
});
