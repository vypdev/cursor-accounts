#!/usr/bin/env node
/**
 * Verify bidi request_id extraction from proxy JSONL + spilled bodies
 * using the same logic as src/proxy/runSseCorrelation.ts (compiled).
 *
 * Usage:
 *   node scripts/verify-request-id-jsonl.mjs [log.jsonl|log-dir]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bodyBufferFromEntry } from './lib/proxy-log-body.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_LOG_DIR = path.join(
  process.env.HOME ?? '',
  '.cursor-accounts',
  'proxy',
  'logs'
);

const { extractBidiRequestIdFromBody } = await import(
  pathToFileURL(path.join(REPO_ROOT, 'out/proxy/runSseCorrelation.js')).href
);
const { buildTrafficSummary } = await import(
  pathToFileURL(path.join(REPO_ROOT, 'out/proxy/trafficSummaryBuilder.js')).href
);

function isAgentRpc(url) {
  return /BidiAppend|RunSSE|RunPoll|BidiPoll|AgentService/.test(url);
}

function isRunSseRequest(entry) {
  return (
    entry.direction === 'request' &&
    /RunSSE|StreamBidiSSE/.test(entry.url ?? '')
  );
}

function isBidiAppendRequest(entry) {
  return entry.direction === 'request' && /BidiAppend/.test(entry.url ?? '');
}

async function analyzeJsonlLine(entry, logDir) {
  const contentType = entry.headers?.['content-type'] ?? '';
  const contentEncoding = entry.headers?.['content-encoding'];
  const raw = bodyBufferFromEntry(entry, logDir);
  const httpRequestId = entry.requestId;

  const result = {
    url: entry.url,
    direction: entry.direction,
    httpRequestId,
    bidiFromRunSse: null,
    bidiFromInsights: null,
    conversationId: null,
    tokenDelta: null,
    decodeError: null,
  };

  if (isRunSseRequest(entry) && raw) {
    result.bidiFromRunSse = await extractBidiRequestIdFromBody(
      raw,
      contentType,
      contentEncoding
    );
  }

  try {
    const summary = await buildTrafficSummary(entry, undefined, {
      logDir,
      decode: true,
    });
    result.bidiFromInsights = summary.insights?.agent?.requestId ?? null;
    result.conversationId =
      summary.insights?.agent?.conversationId ??
      summary.insights?.context?.conversationId ??
      null;
    if (summary.insights?.agent?.usageEvent === 'token_delta') {
      result.tokenDelta = summary.insights.agent.streamingTokens ?? null;
    }
    if (summary.decodeError) {
      result.decodeError = summary.decodeError;
    }
  } catch (err) {
    result.decodeError = err instanceof Error ? err.message : String(err);
  }

  return result;
}

async function analyzeSpilledBody(filePath, logDir) {
  const name = path.basename(filePath);
  const uuidPrefix = name.replace(/-(request|response)\.bin$/, '');
  const raw = fs.readFileSync(filePath);

  // BidiAppend bodies are large AgentClientMessage payloads — use the same
  // decode path as live traffic (buildTrafficSummary), not RunSSE extraction.
  const entry = {
    direction: 'request',
    url: 'https://api2.cursor.sh/aiserver.v1.BidiService/BidiAppend',
    headers: { 'content-type': 'application/connect+proto' },
    bodyFile: path.join('bodies', name),
    isConnectRpc: true,
    requestId: uuidPrefix,
  };

  let bidiFromDecode = null;
  let conversationId = null;
  try {
    const summary = await buildTrafficSummary(entry, undefined, {
      logDir,
      decode: true,
    });
    bidiFromDecode = summary.insights?.agent?.requestId ?? null;
    conversationId =
      summary.insights?.agent?.conversationId ??
      summary.insights?.context?.conversationId ??
      null;
  } catch {
    // ignore
  }

  return {
    file: name,
    filenameUuid: uuidPrefix,
    bidiFromDecode,
    conversationId,
    bytes: raw.length,
  };
}

async function main() {
  const target = path.resolve(process.argv[2] ?? DEFAULT_LOG_DIR);
  if (!fs.existsSync(target)) {
    console.error(`Not found: ${target}`);
    process.exit(1);
  }

  const logDir = fs.statSync(target).isFile() ? path.dirname(target) : target;
  const files = fs.statSync(target).isFile()
    ? [path.basename(target)]
    : fs.readdirSync(logDir).filter((f) => f.endsWith('.jsonl'));

  console.log('=== JSONL request_id extraction audit ===\n');

  let agentLines = 0;
  let runSseRequests = 0;
  let bidiAppends = 0;
  let runSseExtractOk = 0;
  let runSseExtractFail = 0;
  let insightsRequestIdOk = 0;
  let conversationIdOk = 0;
  let tokenDeltaLines = 0;

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
      if (!isAgentRpc(entry.url ?? '')) continue;

      agentLines += 1;
      const r = await analyzeJsonlLine(entry, logDir);

      if (isRunSseRequest(entry)) {
        runSseRequests += 1;
        if (r.bidiFromRunSse) runSseExtractOk += 1;
        else runSseExtractFail += 1;
        console.log(
          `[RunSSE req] http=${r.httpRequestId?.slice(0, 8)}… bidiExtract=${r.bidiFromRunSse ?? 'FAIL'} insights=${r.bidiFromInsights ?? '-'} conv=${r.conversationId ?? '-'}`
        );
      }

      if (isBidiAppendRequest(entry)) {
        bidiAppends += 1;
        console.log(
          `[BidiAppend] http=${r.httpRequestId?.slice(0, 8)}… bidi=${r.bidiFromInsights ?? 'FAIL'} conv=${r.conversationId ?? '-'}`
        );
      }

      if (r.bidiFromInsights) insightsRequestIdOk += 1;
      if (r.conversationId) conversationIdOk += 1;
      if (r.tokenDelta != null) {
        tokenDeltaLines += 1;
        console.log(
          `[token_delta] http=${r.httpRequestId?.slice(0, 8)}… bidi=${r.bidiFromInsights ?? '-'} delta=${r.tokenDelta} conv=${r.conversationId ?? '-'}`
        );
      }
    }
  }

  console.log('\n--- JSONL summary ---');
  console.log(`Agent RPC lines: ${agentLines}`);
  console.log(`RunSSE requests: ${runSseRequests} (bidi extracted: ${runSseExtractOk}, failed: ${runSseExtractFail})`);
  console.log(`BidiAppend requests: ${bidiAppends}`);
  console.log(`Lines with insights.agent.requestId: ${insightsRequestIdOk}`);
  console.log(`Lines with conversationId: ${conversationIdOk}`);
  console.log(`Lines with token_delta: ${tokenDeltaLines}`);

  const bodiesDir = path.join(logDir, 'bodies');
  if (fs.existsSync(bodiesDir)) {
    console.log('\n=== Spilled body files (UUID-named request.bin) ===\n');
    const bodyFiles = fs
      .readdirSync(bodiesDir)
      .filter((f) => /^[0-9a-f-]{36}-request\.bin$/i.test(f))
      .slice(0, 10);

    let bodyExtractOk = 0;
    let bodyExtractFail = 0;
    for (const f of bodyFiles) {
      const r = await analyzeSpilledBody(path.join(bodiesDir, f), logDir);
      if (r.bidiFromDecode) bodyExtractOk += 1;
      else bodyExtractFail += 1;
      const match = r.bidiFromDecode === r.filenameUuid ? 'MATCH' : 'MISMATCH';
      console.log(
        `[body] ${r.filenameUuid.slice(0, 8)}… bidi=${r.bidiFromDecode ?? 'FAIL'} filename=${match} conv=${r.conversationId ?? '-'} (${(r.bytes / 1e6).toFixed(1)}MB)`
      );
    }
    console.log(`\nSpilled bodies sampled: ${bodyFiles.length} (bidi ok: ${bodyExtractOk}, fail: ${bodyExtractFail})`);
  }
}

await main();
