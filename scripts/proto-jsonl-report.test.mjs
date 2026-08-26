import assert from 'node:assert/strict';
import test from 'node:test';
import {
  renderProtoJsonlReport,
  summarizeProtoJsonlReport,
} from './lib/proto-jsonl-report.mjs';

function report() {
  return {
    files: ['capture.jsonl'],
    totalEntries: 3,
    skippedNoBody: 1,
    skippedNonConnect: 2,
    base64Bodies: 1,
    insightBilling: 1,
    insightTokens: 2,
    insightContext: 0,
    insightAgent: 1,
    byMethod: new Map([
      [
        'GetCurrentPeriodUsage:response',
        { ok: 2, fail: 1, json: 0, samples: ['invalid response'] },
      ],
      ['GetMe:response', { ok: 1, fail: 0, json: 1, samples: [] }],
    ]),
    dashboard: new Map([
      ['GetCurrentPeriodUsage', { ok: 2, fail: 1 }],
      ['GetMe', { ok: 1, fail: 0 }],
    ]),
  };
}

test('summarizeProtoJsonlReport calculates stable rows, totals, and exit failures', () => {
  const summary = summarizeProtoJsonlReport(report());

  assert.equal(summary.totalOk, 3);
  assert.equal(summary.totalFail, 1);
  assert.equal(summary.totalJson, 1);
  assert.equal(summary.successRate, '75.0');
  assert.deepEqual(summary.usageFails, ['GetCurrentPeriodUsage']);
  assert.deepEqual(summary.usageRows, [
    { method: 'GetCurrentPeriodUsage', ok: 2, total: 3, percentage: '67' },
    { method: 'GetMe', ok: 1, total: 1, percentage: '100' },
  ]);
});

test('renderProtoJsonlReport preserves diagnostic sections and failure samples', () => {
  const current = report();
  const summary = summarizeProtoJsonlReport(current);
  const output = renderProtoJsonlReport(current, summary);

  assert.match(output, /Method:direction/);
  assert.match(output, /!GetCurrentPeriodUsage:response/);
  assert.match(output, /Failures \/ notes/);
  assert.match(output, /invalid response/);
  assert.match(output, /Insights extracted: billing=1, tokens=2, context=0, agent=1/);
  assert.match(output, /GetCurrentPeriodUsage: 2\/3 OK \(67%\)/);
});
