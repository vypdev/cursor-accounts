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

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

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
