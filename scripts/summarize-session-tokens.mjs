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

const DEFAULT_DOLLARS_PER_M = 4;

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

function centsToUsd(cents) {
  return (Number(cents) / 100).toFixed(2);
}

function planSpend(planUsage) {
  if (!planUsage || typeof planUsage !== 'object') {
    return null;
  }
  const total = planUsage.totalSpend ?? planUsage.total_spend;
  const included = planUsage.includedSpend ?? planUsage.included_spend;
  const bonus = planUsage.bonusSpend ?? planUsage.bonus_spend;
  const limit = planUsage.limit;
  return { total, included, bonus, limit };
}

/** Major model steps: counter reset after a large peak (new generation). */
function groupMajorTurnPeaks(peaks) {
  const sorted = [...peaks].sort((a, b) => a.seqno - b.seqno);
  const turns = [];
  let cur = { max: 0, count: 0 };
  for (const p of sorted) {
    if (cur.count > 0 && cur.max >= 300 && p.tokens <= 150) {
      turns.push({ max: cur.max, count: cur.count });
      cur = { max: 0, count: 0 };
    }
    cur.count += 1;
    if (p.tokens > cur.max) {
      cur.max = p.tokens;
    }
  }
  if (cur.count > 0) {
    turns.push({ max: cur.max, count: cur.count });
  }
  return turns;
}

function recordAgentInsight(insight, ts, tokenPeaks, turnEndedTotals, counters) {
  if (!insight) {
    return;
  }
  if (insight.usageEvent === 'turn_ended') {
    counters.turnEndedCount += 1;
    turnEndedTotals.input += Number(insight.inputTokens) || 0;
    turnEndedTotals.output += Number(insight.outputTokens) || 0;
    turnEndedTotals.cacheRead += Number(insight.cacheReadTokens) || 0;
    turnEndedTotals.cacheWrite += Number(insight.cacheWriteTokens) || 0;
  } else if (insight.usageEvent === 'token_delta' && insight.streamingTokens != null) {
    tokenPeaks.push({
      ts,
      seqno: 0,
      tokens: insight.streamingTokens,
    });
  } else if (insight.usageEvent === 'token_details') {
    counters.tokenDetailsCount += 1;
  }
}

async function analyzeFile(filePath, root, rpcMap) {
  const logDir = path.dirname(filePath);
  const billingSnapshots = [];
  const tokenPeaks = [];
  let turnEndedCount = 0;
  let tokenDetailsCount = 0;
  let turnEndedTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  const requestIds = new Set();
  let firstTs = null;
  let lastTs = null;

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
    if (ts) {
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;
    }

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
      if (spend?.total != null) {
        billingSnapshots.push({ ts, ...spend });
      }
    }

    if (rpcPath.includes('BidiAppend') && entry.direction === 'request') {
      const agent = extractAgentInsight(obj);
      if (agent?.requestId) {
        requestIds.add(agent.requestId);
      }
    }

    const agentServerType = root.lookupType('agent.v1.AgentServerMessage');
    const counters = { turnEndedCount, tokenDetailsCount };

    if (rpcPath.includes('RunSSE') && entry.direction === 'response') {
      const raw = bodyBufferFromEntry(entry, logDir);
      if (raw?.length && agentServerType) {
        for (const msg of scanAgentServerStream(agentServerType, raw)) {
          recordAgentInsight(
            extractAgentInnerInsight(msg),
            ts,
            tokenPeaks,
            turnEndedTotals,
            counters
          );
        }
      }
      turnEndedCount = counters.turnEndedCount;
      tokenDetailsCount = counters.tokenDetailsCount;
      continue;
    }

    if (!rpcPath.includes('RunPoll') || entry.direction !== 'response') {
      continue;
    }

    const inner = await decodeBidiAgentInner(obj, rpcPath, entry.direction);
    recordAgentInsight(
      inner ? extractAgentInnerInsight(inner) : null,
      ts,
      tokenPeaks,
      turnEndedTotals,
      counters
    );
    turnEndedCount = counters.turnEndedCount;
    tokenDetailsCount = counters.tokenDetailsCount;
  }

  const majorTurns = groupMajorTurnPeaks(tokenPeaks);
  const maxSinglePeak = tokenPeaks.reduce(
    (m, p) => Math.max(m, p.tokens),
    0
  );
  const sumMajorTurnPeaks = majorTurns.reduce((a, s) => a + s.max, 0);

  const billingSorted = billingSnapshots.sort((a, b) =>
    (a.ts ?? '').localeCompare(b.ts ?? '')
  );
  const firstBill = billingSorted[0];
  const lastBill = billingSorted.at(-1);
  const spendDeltaCents =
    firstBill && lastBill
      ? Number(lastBill.total) - Number(firstBill.total)
      : null;

  const dollarsPerM =
    Number(process.env.CURSOR_ESTIMATED_DOLLARS_PER_M) || DEFAULT_DOLLARS_PER_M;

  return {
    file: path.basename(filePath),
    window: { firstTs, lastTs },
    agentSessions: requestIds.size,
    requestIds: [...requestIds],
    tokenDeltaEvents: tokenPeaks.length,
    maxSinglePeak,
    majorTurns,
    sumMajorTurnPeaks,
    naiveEstUsd: (sumMajorTurnPeaks / 1e6) * dollarsPerM,
    turnEndedCount,
    turnEndedTotals,
    billing: {
      samples: billingSnapshots.length,
      first: firstBill,
      last: lastBill,
      deltaCents: spendDeltaCents,
      deltaUsd: spendDeltaCents != null ? centsToUsd(spendDeltaCents) : null,
    },
    dollarsPerM,
  };
}

function printReport(report) {
  console.log('\n=== Session token & cost report ===\n');
  console.log(`Log: ${report.file}`);
  if (report.window.firstTs) {
    console.log(`Window: ${report.window.firstTs} → ${report.window.lastTs}`);
  }
  console.log(`Agent Bidi request_id(s): ${report.agentSessions}`);
  if (report.requestIds.length) {
    console.log(`  ${report.requestIds.join(', ')}`);
  }

  console.log('\n--- Proxy: token_delta (streaming counter, NOT billed tokens) ---');
  console.log(`Events: ${report.tokenDeltaEvents}`);
  console.log(`Max single counter value: ${report.maxSinglePeak}`);
  console.log(`Major turns (peak≥300 then reset≤150): ${report.majorTurns.length}`);
  for (const [i, s] of report.majorTurns.entries()) {
    console.log(`  turn ${i + 1}: peak ${s.max} (${s.count} delta events)`);
  }
  console.log(`Sum of major-turn peaks: ${report.sumMajorTurnPeaks}`);
  console.log(
    `Naive estimate @ $${report.dollarsPerM}/M on sum of peaks: $${report.naiveEstUsd.toFixed(4)} USD`
  );
  console.log(
    '(This is a progress counter during generation; do not compare 1:1 to dashboard spend.)'
  );

  console.log('\n--- Proxy: turn_ended (actual per-turn breakdown when present) ---');
  console.log(`Events: ${report.turnEndedCount}`);
  if (report.turnEndedCount > 0) {
    const t = report.turnEndedTotals;
    console.log(
      `Totals: in=${t.input} out=${t.output} cacheR=${t.cacheRead} cacheW=${t.cacheWrite}`
    );
  } else {
    console.log('(None in this log — billing breakdown may only arrive server-side.)');
  }

  console.log('\n--- Server: GetCurrentPeriodUsage (period spend, cents) ---');
  console.log(`Samples in log: ${report.billing.samples}`);
  if (report.billing.first) {
    const f = report.billing.first;
    const l = report.billing.last;
    console.log(
      `Start totalSpend: ${f.total} cents ($${centsToUsd(f.total)}) @ ${f.ts}`
    );
    console.log(
      `End   totalSpend: ${l.total} cents ($${centsToUsd(l.total)}) @ ${l.ts}`
    );
    console.log(
      `Delta in session window: ${report.billing.deltaCents} cents ($${report.billing.deltaUsd} USD)`
    );
    if (l.included != null) {
      console.log(
        `End plan: included=${l.included} bonus=${l.bonus} limit=${l.limit} cents`
      );
    }
  } else {
    console.log('(No decoded billing responses in log.)');
  }

  console.log('\n--- Reasonableness ---');
  if (report.billing.deltaCents != null) {
    const serverUsd = Number(report.billing.deltaUsd);
    const ratio =
      report.naiveEstUsd > 0 ? serverUsd / report.naiveEstUsd : null;
    console.log(
      `Server period spend moved $${serverUsd.toFixed(2)} during this capture.`
    );
    console.log(
      `That includes all Cursor usage in the period counter, not only this agent chat.`
    );
    if (report.turnEndedCount === 0 && report.tokenDeltaEvents > 0) {
      console.log(
        'token_delta peaks are UI/progress signals; $6–8 in ~15–20 min of heavy Agent is plausible.'
      );
      console.log(
        'For per-request tokens+cost, use dashboard get-filtered-usage-events (see docs/USAGE-EVENTS-API.md).'
      );
    }
    if (ratio != null && ratio > 10) {
      console.log(
        `Ratio serverΔ / naiveProxyEst ≈ ${ratio.toFixed(0)}× — expected; counters ≠ billed tokens.`
      );
    }
  }
  console.log('');
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
    printReport(report);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
