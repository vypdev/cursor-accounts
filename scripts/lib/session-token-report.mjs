/**
 * Pure text presentation for session token and cost reports.
 */

import { centsToUsd } from './session-token-summary.mjs';

/**
 * @param {Record<string, any>} report
 * @returns {string}
 */
export function renderSessionReport(report) {
  const lines = [
    '',
    '=== Session token & cost report ===',
    '',
    `Log: ${report.file}`,
  ];

  if (report.window.firstTs) {
    lines.push(`Window: ${report.window.firstTs} → ${report.window.lastTs}`);
  }

  lines.push(`Agent Bidi request_id(s): ${report.agentSessions}`);
  if (report.requestIds.length) {
    lines.push(`  ${report.requestIds.join(', ')}`);
  }

  lines.push(
    '',
    '--- Proxy: token_delta (streaming counter, NOT billed tokens) ---',
    `Events: ${report.tokenDeltaEvents}`,
    `Max single counter value: ${report.maxSinglePeak}`,
    `Major turns (peak≥300 then reset≤150): ${report.majorTurns.length}`
  );
  for (const [index, turn] of report.majorTurns.entries()) {
    lines.push(`  turn ${index + 1}: peak ${turn.max} (${turn.count} delta events)`);
  }
  lines.push(
    `Sum of major-turn peaks: ${report.sumMajorTurnPeaks}`,
    `Naive estimate @ $${report.dollarsPerM}/M on sum of peaks: $${report.naiveEstUsd.toFixed(4)} USD`,
    '(This is a progress counter during generation; do not compare 1:1 to dashboard spend.)',
    '',
    '--- Proxy: turn_ended (actual per-turn breakdown when present) ---',
    `Events: ${report.turnEndedCount}`
  );

  if (report.turnEndedCount > 0) {
    const totals = report.turnEndedTotals;
    lines.push(
      `Totals: in=${totals.input} out=${totals.output} cacheR=${totals.cacheRead} cacheW=${totals.cacheWrite}`
    );
  } else {
    lines.push('(None in this log — billing breakdown may only arrive server-side.)');
  }

  lines.push(
    '',
    '--- Server: GetCurrentPeriodUsage (period spend, cents) ---',
    `Samples in log: ${report.billing.samples}`
  );
  if (report.billing.first) {
    const first = report.billing.first;
    const last = report.billing.last;
    lines.push(
      `Start totalSpend: ${first.total} cents ($${centsToUsd(first.total)}) @ ${first.ts}`,
      `End   totalSpend: ${last.total} cents ($${centsToUsd(last.total)}) @ ${last.ts}`,
      `Delta in session window: ${report.billing.deltaCents} cents ($${report.billing.deltaUsd} USD)`
    );
    if (last.included != null) {
      lines.push(
        `End plan: included=${last.included} bonus=${last.bonus} limit=${last.limit} cents`
      );
    }
  } else {
    lines.push('(No decoded billing responses in log.)');
  }

  lines.push('', '--- Reasonableness ---');
  if (report.billing.deltaCents != null) {
    const serverUsd = Number(report.billing.deltaUsd);
    const ratio =
      report.naiveEstUsd > 0 ? serverUsd / report.naiveEstUsd : null;
    lines.push(
      `Server period spend moved $${serverUsd.toFixed(2)} during this capture.`,
      'That includes all Cursor usage in the period counter, not only this agent chat.'
    );
    if (report.turnEndedCount === 0 && report.tokenDeltaEvents > 0) {
      lines.push(
        'token_delta peaks are UI/progress signals; $6–8 in ~15–20 min of heavy Agent is plausible.',
        'For per-request tokens+cost, use dashboard get-filtered-usage-events (see docs/USAGE-EVENTS-API.md).'
      );
    }
    if (ratio != null && ratio > 10) {
      lines.push(
        `Ratio serverΔ / naiveProxyEst ≈ ${ratio.toFixed(0)}× — expected; counters ≠ billed tokens.`
      );
    }
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}
