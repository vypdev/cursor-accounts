import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildSessionReport,
  centsToUsd,
  createSessionSummaryState,
  groupMajorTurnPeaks,
  planSpend,
  recordAgentInsight,
  recordBillingSnapshot,
  recordRequestId,
  recordSessionTimestamp,
} from './lib/session-token-summary.mjs';
import { renderSessionReport } from './lib/session-token-report.mjs';
import {
  analyzeSessionCaptureFile,
  isAgentStreamResponse,
  isDirectionalSessionEntry,
  parseSessionCaptureLine,
} from './lib/session-token-capture-analysis.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

test('session capture entry helpers reject malformed input and classify streams', () => {
  assert.equal(parseSessionCaptureLine('not json'), null);
  assert.equal(parseSessionCaptureLine('[]'), null);
  assert.deepEqual(
    parseSessionCaptureLine('{"direction":"response","timestamp":"t"}'),
    { direction: 'response', timestamp: 't' }
  );
  assert.equal(isDirectionalSessionEntry({ direction: 'request' }), true);
  assert.equal(isDirectionalSessionEntry({ direction: 'event' }), false);
  assert.equal(
    isAgentStreamResponse('/agent.v1.AgentService/RunSSE', 'response'),
    true
  );
  assert.equal(
    isAgentStreamResponse('/agent.v1.AgentService/StreamBidiPoll', 'response'),
    false
  );
  assert.equal(
    isAgentStreamResponse('/agent.v1.AgentService/RunSSE', 'request'),
    false
  );
});

test('session capture analysis composes billing, bidi, poll, and stream policies', async () => {
  const type = {};
  const root = {
    lookupType: () => type,
  };
  const rpcMap = new Map([
    [
      '/aiserver.v1.AiserverService/GetCurrentPeriodUsage',
      { requestType: type, responseType: type },
    ],
    [
      '/agent.v1.AgentService/BidiAppend',
      { requestType: type, responseType: type },
    ],
    [
      '/agent.v1.AgentService/RunPoll',
      { requestType: type, responseType: type },
    ],
    [
      '/agent.v1.AgentService/RunSSE',
      { requestType: type, responseType: type },
    ],
  ]);
  const lines = [
    JSON.stringify({
      direction: 'event',
      timestamp: '2026-08-27T10:00:00.000Z',
    }),
    'malformed',
    JSON.stringify({
      direction: 'response',
      timestamp: '2026-08-27T10:01:00.000Z',
      url: 'https://api/aiserver.v1.AiserverService/GetCurrentPeriodUsage',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planUsage: { totalSpend: 100 } }),
    }),
    JSON.stringify({
      direction: 'request',
      timestamp: '2026-08-27T10:02:00.000Z',
      url: 'https://api/agent.v1.AgentService/BidiAppend',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'agent-1' }),
    }),
    JSON.stringify({
      direction: 'response',
      timestamp: '2026-08-27T10:03:00.000Z',
      url: 'https://api/agent.v1.AgentService/RunPoll',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
    JSON.stringify({
      direction: 'response',
      timestamp: '2026-08-27T10:04:00.000Z',
      url: 'https://api/agent.v1.AgentService/RunSSE',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  ].join('\n');

  const report = await analyzeSessionCaptureFile(
    path.join(os.tmpdir(), 'capture.jsonl'),
    root,
    rpcMap,
    {
      readFile: () => lines,
      decodeInner: async () => ({
        interactionUpdate: {
          turnEnded: {
            inputTokens: 10,
            outputTokens: 20,
          },
        },
      }),
      scanStream: () => [
        { interactionUpdate: { tokenDelta: { tokens: 500 } } },
      ],
      dollarsPerM: 5,
    }
  );

  assert.deepEqual(report.window, {
    firstTs: '2026-08-27T10:01:00.000Z',
    lastTs: '2026-08-27T10:04:00.000Z',
  });
  assert.equal(report.agentSessions, 1);
  assert.equal(report.tokenDeltaEvents, 1);
  assert.equal(report.maxSinglePeak, 500);
  assert.equal(report.turnEndedCount, 1);
  assert.equal(report.turnEndedTotals.input, 10);
  assert.equal(report.turnEndedTotals.output, 20);
  assert.equal(report.billing.deltaCents, 0);
  assert.equal(report.dollarsPerM, 5);
});

test('session summary helpers normalize spend and group reset peaks', () => {
  assert.deepEqual(planSpend({
    total_spend: 250,
    includedSpend: 100,
    bonus_spend: 25,
    limit: 500,
  }), {
    total: 250,
    included: 100,
    bonus: 25,
    limit: 500,
  });
  assert.equal(planSpend(null), null);
  assert.equal(centsToUsd(250), '2.50');

  assert.deepEqual(
    groupMajorTurnPeaks([
      { seqno: 2, tokens: 80 },
      { seqno: 0, tokens: 120 },
      { seqno: 1, tokens: 320 },
      { seqno: 3, tokens: 90 },
    ]),
    [
      { max: 320, count: 2 },
      { max: 90, count: 2 },
    ]
  );
});

test('session summary state records deduplicated events and final report totals', () => {
  const state = createSessionSummaryState();
  recordSessionTimestamp(state, '2026-08-27T10:02:00.000Z');
  recordSessionTimestamp(state, '2026-08-27T10:01:00.000Z');
  recordSessionTimestamp(state, undefined);
  recordRequestId(state, 'request-a');
  recordRequestId(state, 'request-a');
  recordRequestId(state, '');
  recordBillingSnapshot(state, '2026-08-27T10:02:00.000Z', {
    total: 275,
    included: 200,
    bonus: 10,
    limit: 500,
  });
  recordBillingSnapshot(state, '2026-08-27T10:01:00.000Z', {
    total: 250,
    included: 200,
    bonus: 10,
    limit: 500,
  });
  recordAgentInsight({ usageEvent: 'token_delta', streamingTokens: 320 }, 't2', state);
  recordAgentInsight({ usageEvent: 'token_delta', streamingTokens: 90 }, 't3', state);
  recordAgentInsight({
    usageEvent: 'turn_ended',
    inputTokens: '10',
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheWriteTokens: 40,
  }, 't4', state);
  recordAgentInsight({ usageEvent: 'token_details' }, 't5', state);
  recordAgentInsight(null, 't6', state);

  const report = buildSessionReport('capture.jsonl', state, 5);
  const { naiveEstUsd, ...reportWithoutEstimate } = report;
  assert.deepEqual(reportWithoutEstimate, {
    file: 'capture.jsonl',
    window: {
      firstTs: '2026-08-27T10:01:00.000Z',
      lastTs: '2026-08-27T10:02:00.000Z',
    },
    agentSessions: 1,
    requestIds: ['request-a'],
    tokenDeltaEvents: 2,
    maxSinglePeak: 320,
    majorTurns: [{ max: 320, count: 1 }, { max: 90, count: 1 }],
    sumMajorTurnPeaks: 410,
    turnEndedCount: 1,
    turnEndedTotals: {
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
    },
    billing: {
      samples: 2,
      first: {
        ts: '2026-08-27T10:01:00.000Z',
        total: 250,
        included: 200,
        bonus: 10,
        limit: 500,
      },
      last: {
        ts: '2026-08-27T10:02:00.000Z',
        total: 275,
        included: 200,
        bonus: 10,
        limit: 500,
      },
      deltaCents: 25,
      deltaUsd: '0.25',
    },
    dollarsPerM: 5,
  });
  assert.ok(Math.abs(naiveEstUsd - 0.00205) < Number.EPSILON);

  const rendered = renderSessionReport(report);
  assert.match(rendered, /Window: 2026-08-27T10:01:00\.000Z/);
  assert.match(rendered, /Totals: in=10 out=20 cacheR=30 cacheW=40/);
  assert.match(rendered, /End plan: included=200 bonus=10 limit=500 cents/);
  assert.match(rendered, /Ratio serverΔ \/ naiveProxyEst/);
});

test('summarize-session-tokens CLI renders an empty JSONL capture', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'cursor-accounts-session-summary-')
  );
  const file = path.join(directory, 'capture.jsonl');
  fs.writeFileSync(file, '');

  try {
    const result = spawnSync(
      process.execPath,
      [path.join(SCRIPT_DIRECTORY, 'summarize-session-tokens.mjs'), file],
      { encoding: 'utf8' }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.error, undefined);
    assert.match(result.stdout, /Session token & cost report/);
    assert.match(result.stdout, /Agent Bidi request_id\(s\): 0/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
