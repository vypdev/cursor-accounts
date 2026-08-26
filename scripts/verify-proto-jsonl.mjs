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
  const rows = [...report.byMethod.entries()].sort((a, b) => {
    const totalA = a[1].ok + a[1].fail + a[1].json;
    const totalB = b[1].ok + b[1].fail + b[1].json;
    return totalB - totalA;
  });

  let totalOk = 0;
  let totalFail = 0;
  let totalJson = 0;

  console.log(
    'Method:direction'.padEnd(42),
    'OK'.padStart(5),
    'FAIL'.padStart(5),
    'JSON'.padStart(5),
    'TOTAL'.padStart(6)
  );
  console.log('-'.repeat(68));

  for (const [key, s] of rows) {
    const total = s.ok + s.fail + s.json;
    totalOk += s.ok;
    totalFail += s.fail;
    totalJson += s.json;
    if (total === 0) continue;
    const mark = s.fail > 0 ? '!' : ' ';
    console.log(
      `${mark}${key.padEnd(41)} ${String(s.ok).padStart(5)} ${String(s.fail).padStart(5)} ${String(s.json).padStart(5)} ${String(total).padStart(6)}`
    );
  }

  console.log('-'.repeat(68));
  console.log(
    `TOTAL`.padEnd(42),
    String(totalOk).padStart(5),
    String(totalFail).padStart(5),
    String(totalJson).padStart(5),
    String(totalOk + totalFail + totalJson).padStart(6)
  );
  console.log(
    `\nLog files: ${report.files.length}, Connect RPC entries: ${report.totalEntries}, empty body: ${report.skippedNoBody}, non-RPC skipped: ${report.skippedNonConnect}, base64 bodies: ${report.base64Bodies}`
  );
  console.log(
    `Insights extracted: billing=${report.insightBilling}, tokens=${report.insightTokens}, context=${report.insightContext}, agent=${report.insightAgent}`
  );

  const failures = rows.filter(([, s]) => s.fail > 0);
  if (failures.length > 0) {
    console.log('\n## Failures / notes (sample)\n');
    for (const [key, s] of failures.slice(0, 25)) {
      console.log(`### ${key}`);
      for (const sample of s.samples) {
        console.log(`  - ${sample}`);
      }
    }
  }

  const successRate =
    totalOk + totalFail > 0
      ? ((100 * totalOk) / (totalOk + totalFail)).toFixed(1)
      : 'n/a';
  console.log(
    `\nDecode/validation rate (excl. JSON-only counted separately): ${successRate}% OK among proto+JSON validated (${totalOk} ok, ${totalFail} fail). JSON Connect entries: ${totalJson}.`
  );

  const usageMethods = [
    'GetCurrentPeriodUsage',
    'GetUsageLimitStatusAndActiveGrants',
    'GetPlanInfo',
    'GetTokenUsage',
    'GetTeams',
    'GetMe',
  ];
  console.log('\n## Billing / dashboard RPCs (any direction)\n');
  for (const m of usageMethods) {
    const d = report.dashboard.get(m);
    if (!d) continue;
    const t = d.ok + d.fail;
    if (t === 0) continue;
    const pct = ((100 * d.ok) / t).toFixed(0);
    console.log(`  ${m}: ${d.ok}/${t} OK (${pct}%)`);
  }

  const usageFails = usageMethods.filter((m) => {
    const d = report.dashboard.get(m);
    return d && d.fail > 0;
  });
  process.exit(usageFails.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
