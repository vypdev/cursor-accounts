#!/usr/bin/env node
/**
 * Analyze MITM proxy JSONL logs with proto decode + insight extraction.
 *
 * Usage:
 *   node scripts/analyze-proxy-traffic.mjs [log-dir]
 *   pnpm run analyze:proxy-traffic
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  analyzeProxyFiles,
  resolveProxyLogFiles,
} from './lib/proxy-traffic-analysis.mjs';
import { loadCursorProtos } from './lib/cursor-proto-runtime.mjs';
import {
  buildRpcTypeMap,
  isInteractiveRpcPath,
} from './lib/proxy-rpc.mjs';

const DEFAULT_LOG_DIR = path.join(
  os.homedir(),
  '.cursor-accounts',
  'proxy',
  'logs'
);

async function main() {
  const target = path.resolve(process.argv[2] ?? DEFAULT_LOG_DIR);
  if (!fs.existsSync(target)) {
    console.error(`Not found: ${target}`);
    process.exit(1);
  }

  const root = await loadCursorProtos();
  const rpcMap = buildRpcTypeMap(root, protobuf.Service);
  const { files, logDir } = resolveProxyLogFiles(target);
  const report = await analyzeProxyFiles(files, logDir, rpcMap);

  for (const sample of report.insightSamples) {
    console.log(`\n## ${sample.key} (${sample.file})`);
    if (sample.billing) console.log('  billing:', JSON.stringify(sample.billing).slice(0, 280));
    if (sample.tokens) console.log('  tokens:', JSON.stringify(sample.tokens).slice(0, 200));
    if (sample.context) console.log('  context:', JSON.stringify(sample.context));
    if (sample.agent) console.log('  agent:', JSON.stringify(sample.agent));
  }

  console.log(`\nFiles: ${files.length}`);
  console.log(`Entries (Connect RPC req/resp): ${report.total}`);
  console.log(`Decoded: ${report.decoded}`);
  console.log(`Interactive RPC decoded: ${report.interactiveDecoded}`);
  console.log(`With insights: ${report.insights}`);
  console.log(`Agent token events (token_delta / turn_ended): ${report.agentTokenEvents}`);
  console.log('\nTop decoded RPCs:');
  for (const [k, n] of [...report.byMethod.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    const tag = isInteractiveRpcPath(`/${k.split(':')[0]}`) ? ' *' : '';
    console.log(`  ${k}: ${n}${tag}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
