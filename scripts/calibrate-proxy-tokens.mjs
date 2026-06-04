#!/usr/bin/env node
/**
 * Calibration spike: estimate in/out tokens from proxy-decoded text vs dashboard usage events.
 *
 * Usage:
 *   node scripts/calibrate-proxy-tokens.mjs [log.jsonl]
 *   node scripts/calibrate-proxy-tokens.mjs --user-data-dir ~/.cursor-efraespada_gmail_com [log.jsonl]
 *   pnpm run calibrate:proxy-tokens
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';
import { bodyBufferFromEntry } from './lib/proxy-log-body.mjs';
import {
  decodeBidiAgentInner,
} from './lib/bidi-agent-decode.mjs';
import { connectPayloadCandidates } from './lib/connect-payload.mjs';
import {
  extractTextBucketsFromMessage,
  scanAgentServerStream,
  sumStreamDeltaText,
  sumUniquePrefetchedBlobChars,
} from './lib/agent-text-extract.mjs';
import {
  countTextTokens,
  encodingForCursorModel,
  estimateTokensFromChars,
  tokenizeTextBucketsFromMessage,
} from './lib/ai-token-estimate.mjs';
import {
  buildRpcTypeMap,
  parseConnectRpcPath,
  resolveRpcMessageType,
} from './lib/proxy-rpc.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_LOG_DIR = path.join(os.homedir(), '.cursor-accounts', 'proxy', 'logs');
const PROTO_FILES = [
  path.join(REPO_ROOT, 'proto', 'agent', 'v1', 'agent.proto'),
  path.join(REPO_ROOT, 'proto', 'aiserver', 'v1', 'aiserver.proto'),
];

function parseArgs(argv) {
  const args = {
    logPath: undefined,
    userDataDir: path.join(os.homedir(), '.cursor-efraespada_gmail_com'),
    skipDashboard: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--user-data-dir' && argv[i + 1]) {
      args.userDataDir = argv[++i].replace(/^~/, os.homedir());
    } else if (argv[i] === '--skip-dashboard') {
      args.skipDashboard = true;
    } else if (!argv[i].startsWith('-')) {
      args.logPath = argv[i].replace(/^~/, os.homedir());
    }
  }
  if (!args.logPath) {
    const files = fs
      .readdirSync(DEFAULT_LOG_DIR)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, m: fs.statSync(path.join(DEFAULT_LOG_DIR, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    args.logPath = path.join(DEFAULT_LOG_DIR, files[0]?.f ?? '');
  }
  return args;
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
        arrays: true,
        objects: true,
        oneofs: true,
      });
    } catch {
      // continue
    }
  }
  return null;
}

function sqliteBinary() {
  const platform = `${process.platform}-${process.arch}`;
  const bin = path.join(REPO_ROOT, 'bin', platform, 'sqlite3');
  return fs.existsSync(bin) ? bin : 'sqlite3';
}

function readDbKey(dbPath, key) {
  const escapedKey = key.replace(/'/g, "''");
  const sql = `SELECT value FROM ItemTable WHERE key = '${escapedKey}' LIMIT 1;`;
  const raw = execFileSync(sqliteBinary(), ['-readonly', dbPath, sql], {
    encoding: 'utf8',
  }).trim();
  if (!raw) {
    return undefined;
  }
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

function buildWorkosSessionCookie(accessToken) {
  const payload = JSON.parse(
    Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')
  );
  const sub = payload.sub;
  const userId = sub.includes('|') ? sub.split('|').pop() : sub;
  return `WorkosCursorSessionToken=${userId}%3A%3A${accessToken}`;
}

async function fetchUsageEvents(cookie, startMs, endMs) {
  /** @type {Record<string, unknown>[]} */
  const events = [];
  for (let page = 1; page <= 30; page += 1) {
    const response = await fetch(
      'https://cursor.com/api/dashboard/get-filtered-usage-events',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: 'https://cursor.com',
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate: String(startMs),
          endDate: String(endMs),
          page,
          pageSize: 100,
        }),
      }
    );
    const body = await response.json();
    if (!response.ok) {
      throw new Error(
        `get-filtered-usage-events HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}`
      );
    }
    const batch =
      body.usageEventsDisplay ??
      body.usage_events_display ??
      body.usageEvents ??
      [];
    events.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }
  return events.filter((event) => {
    const ts = Number(event.timestamp);
    return Number.isFinite(ts) && ts >= startMs && ts <= endMs;
  });
}

function sumDashboard(events) {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let chargedCents = 0;
  /** @type {Map<string, number>} */
  const byModel = new Map();
  for (const event of events) {
    const tu = event.tokenUsage ?? event.token_usage ?? {};
    input += Number(tu.inputTokens ?? tu.input_tokens ?? 0);
    output += Number(tu.outputTokens ?? tu.output_tokens ?? 0);
    cacheRead += Number(tu.cacheReadTokens ?? tu.cache_read_tokens ?? 0);
    cacheWrite += Number(tu.cacheWriteTokens ?? tu.cache_write_tokens ?? 0);
    chargedCents += Number(event.chargedCents ?? event.charged_cents ?? 0);
    const model = String(event.model ?? 'unknown');
    byModel.set(model, (byModel.get(model) ?? 0) + 1);
  }
  return { input, output, cacheRead, cacheWrite, chargedCents, byModel };
}

function ratio(a, b) {
  if (!b) {
    return b === 0 && a === 0 ? 1 : Infinity;
  }
  return a / b;
}

function formatRatio(label, estimate, actual) {
  const r = ratio(estimate, actual);
  const pct =
    Number.isFinite(r) && actual > 0
      ? `${((estimate / actual) * 100).toFixed(1)}% of dashboard`
      : 'n/a';
  return `${label}: est=${estimate.toLocaleString()} actual=${actual.toLocaleString()} (${pct})`;
}

async function analyzeLog(logPath, root, rpcMap) {
  const logDir = path.dirname(logPath);
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);

  let firstTs = null;
  let lastTs = null;

  /** @type {Record<string, unknown>[]} */
  const bidiClientMessages = [];
  /** @type {Record<string, unknown>[]} */
  const bidiServerMessages = [];
  /** @type {Record<string, unknown>[]} */
  const runsseMessages = [];
  /** @type {Map<string, number>} */
  const byRequestId = new Map();

  const ServerType = root.lookupType('agent.v1.AgentServerMessage');

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!firstTs) {
      firstTs = entry.timestamp;
    }
    lastTs = entry.timestamp;

    const rpcPath = parseConnectRpcPath(entry.url ?? '');
    if (!rpcPath) {
      continue;
    }

    const Type = resolveRpcMessageType(rpcPath, entry.direction, rpcMap);
    if (!Type) {
      continue;
    }

    const raw = bodyBufferFromEntry(entry, logDir);
    if (!raw?.length) {
      continue;
    }

    const outer = tryDecode(Type, raw);
    if (!outer) {
      continue;
    }

    if (rpcPath.includes('BidiAppend')) {
      const inner = await decodeBidiAgentInner(outer, rpcPath, entry.direction);
      if (!inner) {
        continue;
      }
      if (entry.direction === 'request') {
        bidiClientMessages.push(inner);
      } else {
        bidiServerMessages.push(inner);
      }
      const reqId = outer.requestId ?? outer.request_id ?? entry.requestId;
      if (reqId) {
        byRequestId.set(reqId, (byRequestId.get(reqId) ?? 0) + 1);
      }
    }

    if (rpcPath.includes('RunSSE') && entry.direction === 'response') {
      runsseMessages.push(...scanAgentServerStream(ServerType, raw));
    }
  }

  const clientBuckets = bidiClientMessages.map((message) => ({
    ...extractTextBucketsFromMessage(message),
    frameCount: 1,
  }));
  const serverBuckets = [
    ...bidiServerMessages.map((message) => ({
      ...extractTextBucketsFromMessage(message),
      frameCount: 1,
    })),
    ...runsseMessages.map((message) => ({
      ...extractTextBucketsFromMessage(message),
      frameCount: 1,
    })),
  ];

  const clientMerged = clientBuckets.reduce(
    (acc, b) => ({
      inputChars: acc.inputChars + b.inputChars,
      outputChars: acc.outputChars + b.outputChars,
      miscChars: acc.miscChars + b.miscChars,
      frameCount: acc.frameCount + b.frameCount,
      checkpointUsedTokens: acc.checkpointUsedTokens.concat(b.checkpointUsedTokens),
      inputSnippets: acc.inputSnippets.concat(b.inputSnippets).slice(0, 8),
      outputSnippets: acc.outputSnippets.concat(b.outputSnippets).slice(0, 8),
    }),
    {
      inputChars: 0,
      outputChars: 0,
      miscChars: 0,
      frameCount: 0,
      checkpointUsedTokens: [],
      inputSnippets: [],
      outputSnippets: [],
    }
  );
  const serverMerged = serverBuckets.reduce(
    (acc, b) => ({
      inputChars: acc.inputChars + b.inputChars,
      outputChars: acc.outputChars + b.outputChars,
      miscChars: acc.miscChars + b.miscChars,
      frameCount: acc.frameCount + b.frameCount,
      checkpointUsedTokens: acc.checkpointUsedTokens.concat(b.checkpointUsedTokens),
      inputSnippets: acc.inputSnippets.concat(b.inputSnippets).slice(0, 8),
      outputSnippets: acc.outputSnippets.concat(b.outputSnippets).slice(0, 8),
    }),
    {
      inputChars: 0,
      outputChars: 0,
      miscChars: 0,
      frameCount: 0,
      checkpointUsedTokens: [],
      inputSnippets: [],
      outputSnippets: [],
    }
  );

  const streamStats = sumStreamDeltaText(runsseMessages);
  const uniquePrefetchedChars = sumUniquePrefetchedBlobChars(bidiClientMessages);

  const clientInputEncoding = encodingForCursorModel('default');
  const clientOutputEncoding = encodingForCursorModel('composer-2.5-fast');

  const clientTokenBuckets = bidiClientMessages.reduce(
    (acc, message) => {
      const bucket = tokenizeTextBucketsFromMessage(message, clientInputEncoding);
      acc.inputTokens += bucket.inputTokens;
      acc.outputTokens += bucket.outputTokens;
      acc.miscTokens += bucket.miscTokens;
      acc.stringsSeen += bucket.stringsSeen;
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, miscTokens: 0, stringsSeen: 0 }
  );

  const serverTokenBuckets = [...bidiServerMessages, ...runsseMessages].reduce(
    (acc, message) => {
      const bucket = tokenizeTextBucketsFromMessage(message, clientOutputEncoding);
      acc.inputTokens += bucket.inputTokens;
      acc.outputTokens += bucket.outputTokens;
      acc.miscTokens += bucket.miscTokens;
      acc.stringsSeen += bucket.stringsSeen;
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, miscTokens: 0, stringsSeen: 0 }
  );

  const seenPrefetched = new Set();
  let uniquePrefetchedTokens = 0;
  for (const message of bidiClientMessages) {
    const rr = message.runRequest ?? message.run_request;
    const blobs = rr?.preFetchedBlobs ?? rr?.pre_fetched_blobs ?? [];
    if (!Array.isArray(blobs)) {
      continue;
    }
    for (const blob of blobs) {
      const value = blob?.value;
      if (typeof value !== 'string' || value.length < 8 || seenPrefetched.has(value)) {
        continue;
      }
      seenPrefetched.add(value);
      uniquePrefetchedTokens += countTextTokens(value, clientInputEncoding);
    }
  }

  const streamDeltaText = [
    ...runsseMessages.map((message) => {
      const upd = message.interactionUpdate ?? message.interaction_update;
      const parts = [];
      const td = upd?.textDelta ?? upd?.text_delta;
      const th = upd?.thinkingDelta ?? upd?.thinking_delta;
      if (td?.text) {
        parts.push(String(td.text));
      }
      if (th?.text) {
        parts.push(String(th.text));
      }
      return parts.join('');
    }),
  ].filter(Boolean);
  const streamDeltaTokens = streamDeltaText.reduce(
    (sum, text) => sum + countTextTokens(text, clientOutputEncoding),
    0
  );

  return {
    logPath,
    firstTs,
    lastTs,
    startMs: Date.parse(firstTs ?? ''),
    endMs: Date.parse(lastTs ?? ''),
    bidiClientFrames: bidiClientMessages.length,
    bidiServerFrames: bidiServerMessages.length,
    runsseFrames: runsseMessages.length,
    client: clientMerged,
    server: serverMerged,
    streamStats,
    uniquePrefetchedChars,
    uniquePrefetchedTokens,
    clientTokenBuckets,
    serverTokenBuckets,
    streamDeltaTokens,
    byRequestId,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.logPath)) {
    throw new Error(`Log not found: ${args.logPath}`);
  }

  console.log('=== Proxy token calibration spike ===\n');
  console.log('Log:', args.logPath);

  const root = await protobuf.load(PROTO_FILES);
  const rpcMap = buildRpcTypeMap(root, protobuf.Service);
  const analysis = await analyzeLog(args.logPath, root, rpcMap);

  console.log('Window:', analysis.firstTs, '→', analysis.lastTs);
  console.log('BidiAppend client messages:', analysis.bidiClientFrames);
  console.log('BidiAppend server messages:', analysis.bidiServerFrames);
  console.log('RunSSE server frames (decoded):', analysis.runsseFrames);
  console.log('Distinct bidi request_ids:', analysis.byRequestId.size);

  const inputEst = estimateTokensFromChars(analysis.client.inputChars);
  const outputEst = estimateTokensFromChars(analysis.server.outputChars);
  const miscEst = estimateTokensFromChars(analysis.client.miscChars + analysis.server.miscChars);
  const prefetchedEst = estimateTokensFromChars(analysis.uniquePrefetchedChars);
  const streamOutChars =
    analysis.streamStats.textDeltaChars + analysis.streamStats.thinkingDeltaChars;
  const streamOutEst = estimateTokensFromChars(streamOutChars);

  console.log('\n--- Proxy text extraction (character counts) ---');
  console.log(
    'BidiAppend client (input-like paths, naive sum):',
    analysis.client.inputChars.toLocaleString(),
    'chars'
  );
  console.log(
    'Unique preFetchedBlobs (deduped, cache/context proxy):',
    analysis.uniquePrefetchedChars.toLocaleString(),
    'chars'
  );
  console.log(
    'Server output-like paths (Bidi+RunSSE, naive sum):',
    analysis.server.outputChars.toLocaleString(),
    'chars'
  );
  console.log(
    'RunSSE textDelta+thinkingDelta only:',
    streamOutChars.toLocaleString(),
    'chars'
  );
  console.log('Misc/unclassified text:', (analysis.client.miscChars + analysis.server.miscChars).toLocaleString(), 'chars');
  if (analysis.client.inputSnippets.length) {
    console.log('Input sample:', analysis.client.inputSnippets[0]);
  }
  if (analysis.server.outputSnippets.length) {
    console.log('Output sample:', analysis.server.outputSnippets[0]);
  }
  if (analysis.server.checkpointUsedTokens.length) {
    console.log(
      'Checkpoint used_tokens snapshots:',
      analysis.server.checkpointUsedTokens.slice(0, 5).join(', ')
    );
  }

  console.log('\n--- Proxy token estimates (chars/4 heuristics) ---');
  console.log('Input  naive Bidi chars/4:', inputEst.charsDiv4.toLocaleString());
  console.log('Input  unique preFetched chars/4:', prefetchedEst.charsDiv4.toLocaleString());
  console.log('Output naive server chars/4:', outputEst.charsDiv4.toLocaleString());
  console.log('Output RunSSE delta chars/4:', streamOutEst.charsDiv4.toLocaleString());
  console.log('Misc   chars/4:', miscEst.charsDiv4.toLocaleString());

  console.log('\n--- Proxy token estimates (ai-tokenizer) ---');
  console.log(
    `Input  Bidi client [${encodingForCursorModel('default')}]:`,
    analysis.clientTokenBuckets.inputTokens.toLocaleString()
  );
  console.log(
    'Input  unique preFetchedBlobs:',
    analysis.uniquePrefetchedTokens.toLocaleString()
  );
  console.log(
    `Output server paths [${encodingForCursorModel('composer-2.5-fast')}]:`,
    analysis.serverTokenBuckets.outputTokens.toLocaleString()
  );
  console.log('Output RunSSE textDelta tokens:', analysis.streamDeltaTokens.toLocaleString());
  console.log(
    'Misc tokenized strings:',
    (analysis.clientTokenBuckets.miscTokens + analysis.serverTokenBuckets.miscTokens).toLocaleString()
  );

  console.log('\n--- Proxy stream counters (not billing) ---');
  console.log(
    'token_delta events:',
    analysis.streamStats.tokenDeltaEvents,
    'peak:',
    analysis.streamStats.tokenDeltaPeak
  );
  console.log(
    'turn_ended events:',
    analysis.streamStats.turnEndedEvents,
    'in/out:',
    analysis.streamStats.turnEndedInput,
    '/',
    analysis.streamStats.turnEndedOutput
  );

  if (args.skipDashboard) {
    console.log('\n(Skipping dashboard fetch: --skip-dashboard)');
    return;
  }

  const dbPath = path.join(args.userDataDir, 'User', 'globalStorage', 'state.vscdb');
  const accessToken = readDbKey(dbPath, 'cursorAuth/accessToken');
  if (!accessToken) {
    console.log('\nNo access token in', dbPath, '— skipping dashboard comparison.');
    return;
  }

  const cookie = buildWorkosSessionCookie(accessToken);
  const padMs = 2 * 60 * 1000;
  const startMs = analysis.startMs - padMs;
  const endMs = analysis.endMs + padMs;

  console.log('\n--- Dashboard ground truth (get-filtered-usage-events) ---');
  const events = await fetchUsageEvents(cookie, startMs, endMs);
  const dash = sumDashboard(events);
  console.log('Events in window:', events.length);
  console.log(
    'Models:',
    [...dash.byModel.entries()].map(([m, n]) => `${m}×${n}`).join(', ') || 'none'
  );
  console.log('Dashboard inputTokens:', dash.input.toLocaleString());
  console.log('Dashboard outputTokens:', dash.output.toLocaleString());
  console.log('Dashboard cache read/write:', dash.cacheRead.toLocaleString(), '/', dash.cacheWrite.toLocaleString());
  console.log('Dashboard chargedCents:', (dash.chargedCents / 100).toFixed(2), 'USD');

  console.log('\n--- Calibration ratios ---');
  console.log(formatRatio('Input naive Bidi (chars/4)', inputEst.charsDiv4, dash.input));
  console.log(
    formatRatio('Input Bidi (ai-tokenizer)', analysis.clientTokenBuckets.inputTokens, dash.input)
  );
  console.log(
    formatRatio('Unique preFetched chars/4 vs cacheRead', prefetchedEst.charsDiv4, dash.cacheRead)
  );
  console.log(
    formatRatio(
      'Unique preFetched (ai-tokenizer) vs cacheRead',
      analysis.uniquePrefetchedTokens,
      dash.cacheRead
    )
  );
  console.log(formatRatio('Output naive server (chars/4)', outputEst.charsDiv4, dash.output));
  console.log(formatRatio('RunSSE delta text (chars/4)', streamOutEst.charsDiv4, dash.output));
  console.log(
    formatRatio('RunSSE delta (ai-tokenizer)', analysis.streamDeltaTokens, dash.output)
  );
  console.log(
    formatRatio(
      'Output server paths (ai-tokenizer)',
      analysis.serverTokenBuckets.outputTokens,
      dash.output
    )
  );
  console.log(
    formatRatio(
      'token_delta peak vs in+out',
      analysis.streamStats.tokenDeltaPeak,
      dash.input + dash.output
    )
  );
  console.log(
    formatRatio(
      'turn_ended in+out',
      analysis.streamStats.turnEndedInput + analysis.streamStats.turnEndedOutput,
      dash.input + dash.output
    )
  );

  if (events.length > 0 && events.length <= 15) {
    console.log('\n--- Dashboard events (detail) ---');
    for (const event of events) {
      const tu = event.tokenUsage ?? {};
      console.log(
        new Date(Number(event.timestamp)).toISOString(),
        event.model,
        `in=${tu.inputTokens ?? 0} out=${tu.outputTokens ?? 0} cache=${tu.cacheReadTokens ?? 0}/${tu.cacheWriteTokens ?? 0}`,
        `$${((event.chargedCents ?? 0) / 100).toFixed(2)}`
      );
    }
  }

  console.log('\n--- Spike conclusions ---');
  console.log(
    '• BidiAppend naive sum overcounts input (context resent every append) — chars/4 and ai-tokenizer both suffer.'
  );
  console.log(
    '• ai-tokenizer is more accurate than chars/4 on raw text, but proxy extraction is still incomplete.'
  );
  console.log(
    '• Deduped preFetchedBlobs correlate better with cacheRead than with inputTokens.'
  );
  console.log(
    '• RunSSE textDelta captures a tiny fraction of billed output (tools/final text missing).'
  );
  console.log(
    '• token_delta peak is UI progress only; not usable for billing.'
  );
  if (analysis.streamStats.turnEndedEvents === 0) {
    console.log('• turn_ended absent on this log — use dashboard API for billing truth.');
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message ?? error);
  process.exit(1);
});
