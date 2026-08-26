#!/usr/bin/env node
/**
 * Verify extracted protos against MITM proxy JSONL captures.
 *
 * Usage:
 *   node scripts/verify-proto-jsonl.mjs [log-dir]
 *   pnpm run verify:proto-jsonl
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';
import { buildRpcTypeMap } from './lib/proxy-rpc.mjs';
import {
  renderProtoJsonlReport,
  summarizeProtoJsonlReport,
} from './lib/proto-jsonl-report.mjs';
import { verifyLogs } from './lib/proto-jsonl-verifier.mjs';

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

async function main() {
  const logDir = path.resolve(process.argv[2] ?? DEFAULT_LOG_DIR);
  if (!fs.existsSync(logDir)) {
    console.error(`Log dir not found: ${logDir}`);
    process.exit(1);
  }

  console.log('Loading protos...');
  const root = await protobuf.load(PROTO_FILES);
  console.log(`Scanning ${logDir}\n`);

  const rpcMap = buildRpcTypeMap(root, protobuf.Service);
  const report = verifyLogs(logDir, rpcMap);
  const summary = summarizeProtoJsonlReport(report);
  console.log(renderProtoJsonlReport(report, summary));
  process.exit(summary.usageFails.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
