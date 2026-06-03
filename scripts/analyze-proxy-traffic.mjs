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
import {
  extractAgentInsight,
  extractBillingInsight,
  extractContextInsight,
  extractTokenInsight,
} from './lib/proxy-insights.mjs';
import {
  buildRpcTypeMap,
  isInteractiveRpcPath,
  parseConnectRpcPath,
  resolveRpcMessageType,
} from './lib/proxy-rpc.mjs';

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

async function main() {
  const target = path.resolve(process.argv[2] ?? DEFAULT_LOG_DIR);
  if (!fs.existsSync(target)) {
    console.error(`Not found: ${target}`);
    process.exit(1);
  }

  const root = await protobuf.load(PROTO_FILES);
  const rpcMap = buildRpcTypeMap(root, protobuf.Service);
  const files = fs.statSync(target).isFile()
    ? [target]
    : fs.readdirSync(target).filter((f) => f.endsWith('.jsonl'));
  const logDir = fs.statSync(target).isFile() ? path.dirname(target) : target;

  let total = 0;
  let decoded = 0;
  let insights = 0;
  let interactiveDecoded = 0;
  /** @type {Map<string, number>} */
  const byMethod = new Map();

  for (const file of files) {
    const filePath = fs.statSync(target).isFile() ? target : path.join(logDir, file);
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
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

      const rpcPath = parseConnectRpcPath(entry.url ?? '');
      if (!rpcPath) continue;

      total++;
      const Type = resolveRpcMessageType(
        rpcPath,
        entry.direction,
        rpcMap
      );
      if (!Type) continue;

      const ct = (entry.headers?.['content-type'] ?? '').toLowerCase();
      let obj = null;

      if (ct.includes('json') && entry.body) {
        try {
          obj = JSON.parse(entry.body);
        } catch {
          // skip
        }
      } else {
        const raw = bodyBufferFromEntry(entry, logDir);
        if (raw) {
          obj = tryDecode(Type, raw);
        }
      }

      if (!obj) continue;
      decoded++;

      const methodKey = rpcPath.replace(/^\//, '');
      const key = `${methodKey}:${entry.direction}`;
      byMethod.set(key, (byMethod.get(key) ?? 0) + 1);

      if (isInteractiveRpcPath(rpcPath)) {
        interactiveDecoded++;
      }

      const billing = extractBillingInsight(obj);
      const tokens = extractTokenInsight(obj);
      const context = extractContextInsight(obj);
      const agent = extractAgentInsight(obj);
      if (billing || tokens || context || agent) {
        insights++;
        if (insights <= 20) {
          console.log(`\n## ${key} (${file})`);
          if (billing) console.log('  billing:', JSON.stringify(billing).slice(0, 280));
          if (tokens) console.log('  tokens:', JSON.stringify(tokens).slice(0, 200));
          if (context) console.log('  context:', JSON.stringify(context));
          if (agent) console.log('  agent:', JSON.stringify(agent));
        }
      }
    }
  }

  console.log(`\nFiles: ${files.length}`);
  console.log(`Entries (Connect RPC req/resp): ${total}`);
  console.log(`Decoded: ${decoded}`);
  console.log(`Interactive RPC decoded: ${interactiveDecoded}`);
  console.log(`With insights: ${insights}`);
  console.log('\nTop decoded RPCs:');
  for (const [k, n] of [...byMethod.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    const tag = isInteractiveRpcPath(`/${k.split(':')[0]}`) ? ' *' : '';
    console.log(`  ${k}: ${n}${tag}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
