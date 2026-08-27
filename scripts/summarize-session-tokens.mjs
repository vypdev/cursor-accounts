#!/usr/bin/env node
/**
 * Session cost report from a single proxy JSONL log (or directory).
 *
 * Usage:
 *   node scripts/summarize-session-tokens.mjs [log.jsonl]
 *   pnpm run summarize:session-tokens
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';
import { bodyBufferFromEntry } from './lib/proxy-log-body.mjs';
import {
  extractAgentInsight,
  extractBillingInsight,
} from './lib/proxy-insights.mjs';
import {
  decodeBidiAgentInner,
  extractAgentInnerInsight,
} from './lib/bidi-agent-decode.mjs';
import { scanAgentServerStream } from './lib/agent-text-extract.mjs';
import {
  buildRpcTypeMap,
  parseConnectRpcPath,
  resolveRpcMessageType,
} from './lib/proxy-rpc.mjs';
import { connectPayloadCandidates } from './lib/connect-payload.mjs';
import {
  DEFAULT_DOLLARS_PER_M,
  buildSessionReport,
  createSessionSummaryState,
  planSpend,
  recordAgentInsight,
  recordBillingSnapshot,
  recordRequestId,
  recordSessionTimestamp,
} from './lib/session-token-summary.mjs';
import { renderSessionReport } from './lib/session-token-report.mjs';

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

async function analyzeFile(filePath, root, rpcMap) {
  const logDir = path.dirname(filePath);
  const summary = createSessionSummaryState();
  const agentServerType = root.lookupType('agent.v1.AgentServerMessage');

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
    const ts = entry.timestamp;
    recordSessionTimestamp(summary, ts);

    const rpcPath = parseConnectRpcPath(entry.url ?? '');
    if (!rpcPath) continue;

    const Type = resolveRpcMessageType(rpcPath, entry.direction, rpcMap);
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

    if (rpcPath.includes('GetCurrentPeriodUsage') && entry.direction === 'response') {
      const billing = extractBillingInsight(obj);
      const spend = planSpend(billing?.planUsage);
      if (spend) recordBillingSnapshot(summary, ts, spend);
    }

    if (rpcPath.includes('BidiAppend') && entry.direction === 'request') {
      const agent = extractAgentInsight(obj);
      if (agent?.requestId) {
        recordRequestId(summary, agent.requestId);
      }
    }

    if (
      entry.direction === 'response' &&
      (rpcPath.includes('RunSSE') ||
        rpcPath.includes('StreamBidiSSE') ||
        (rpcPath.includes('StreamBidi') && !rpcPath.includes('StreamBidiPoll')))
    ) {
      const raw = bodyBufferFromEntry(entry, logDir);
      if (raw?.length && agentServerType) {
        for (const msg of scanAgentServerStream(agentServerType, raw)) {
          recordAgentInsight(
            extractAgentInnerInsight(msg),
            ts,
            summary
          );
        }
      }
      continue;
    }

    if (!rpcPath.includes('RunPoll') || entry.direction !== 'response') {
      continue;
    }

    const inner = await decodeBidiAgentInner(obj, rpcPath, entry.direction);
    recordAgentInsight(
      inner ? extractAgentInnerInsight(inner) : null,
      ts,
      summary
    );
  }

  const dollarsPerM =
    Number(process.env.CURSOR_ESTIMATED_DOLLARS_PER_M) || DEFAULT_DOLLARS_PER_M;
  return buildSessionReport(path.basename(filePath), summary, dollarsPerM);
}

async function main() {
  const arg = process.argv[2];
  const target = path.resolve(arg ?? DEFAULT_LOG_DIR);
  if (!fs.existsSync(target)) {
    console.error(`Not found: ${target}`);
    process.exit(1);
  }

  const root = await protobuf.load(PROTO_FILES);
  const rpcMap = buildRpcTypeMap(root, protobuf.Service);

  const files = fs.statSync(target).isFile()
    ? [target]
    : fs
        .readdirSync(target)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => path.join(target, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
        .slice(0, 1);

  if (!files.length) {
    console.error('No .jsonl logs found.');
    process.exit(1);
  }

  for (const filePath of files) {
    const report = await analyzeFile(filePath, root, rpcMap);
    process.stdout.write(renderSessionReport(report));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
