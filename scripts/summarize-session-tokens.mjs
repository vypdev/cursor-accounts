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
import protobuf from 'protobufjs';
import { buildRpcTypeMap } from './lib/proxy-rpc.mjs';
import { loadCursorProtos } from './lib/cursor-proto-runtime.mjs';
import { analyzeSessionCaptureFile } from './lib/session-token-capture-analysis.mjs';
import { renderSessionReport } from './lib/session-token-report.mjs';

const DEFAULT_LOG_DIR = path.join(
  process.env.HOME ?? '',
  '.cursor-accounts',
  'proxy',
  'logs'
);

async function main() {
  const arg = process.argv[2];
  const target = path.resolve(arg ?? DEFAULT_LOG_DIR);
  if (!fs.existsSync(target)) {
    console.error(`Not found: ${target}`);
    process.exit(1);
  }

  const root = await loadCursorProtos();
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
    const report = await analyzeSessionCaptureFile(filePath, root, rpcMap, {
      dollarsPerM:
        Number(process.env.CURSOR_ESTIMATED_DOLLARS_PER_M) || undefined,
    });
    process.stdout.write(renderSessionReport(report));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
