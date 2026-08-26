/**
 * Pure summary and rendering helpers for protobuf JSONL verification reports.
 *
 * The CLI owns process exit and console I/O; this module owns the stable
 * report shape and text presentation.
 */

export const USAGE_METHODS = [
  'GetCurrentPeriodUsage',
  'GetUsageLimitStatusAndActiveGrants',
  'GetPlanInfo',
  'GetTokenUsage',
  'GetTeams',
  'GetMe',
];

/**
 * @typedef {{ rows: Array<[string, { ok: number, fail: number, json: number, samples: string[] }]>, totalOk: number, totalFail: number, totalJson: number, failures: Array<[string, { ok: number, fail: number, json: number, samples: string[] }]>, usageRows: Array<{ method: string, ok: number, total: number, percentage: string }>, usageFails: string[], successRate: string }} ProtoJsonlReportSummary
 */

/**
 * @param {{ byMethod: Map<string, { ok: number, fail: number, json: number, samples: string[] }>, dashboard: Map<string, { ok: number, fail: number }> }} report
 * @returns {ProtoJsonlReportSummary}
 */
export function summarizeProtoJsonlReport(report) {
  const rows = [...report.byMethod.entries()].sort((a, b) => {
    const totalA = a[1].ok + a[1].fail + a[1].json;
    const totalB = b[1].ok + b[1].fail + b[1].json;
    return totalB - totalA;
  });

  let totalOk = 0;
  let totalFail = 0;
  let totalJson = 0;
  for (const [, stats] of rows) {
    totalOk += stats.ok;
    totalFail += stats.fail;
    totalJson += stats.json;
  }

  const failures = rows.filter(([, stats]) => stats.fail > 0);
  const usageRows = [];
  const usageFails = [];
  for (const method of USAGE_METHODS) {
    const stats = report.dashboard.get(method);
    if (!stats) {
      continue;
    }
    const total = stats.ok + stats.fail;
    if (total === 0) {
      continue;
    }
    usageRows.push({
      method,
      ok: stats.ok,
      total,
      percentage: ((100 * stats.ok) / total).toFixed(0),
    });
    if (stats.fail > 0) {
      usageFails.push(method);
    }
  }

  const validated = totalOk + totalFail;
  return {
    rows,
    totalOk,
    totalFail,
    totalJson,
    failures,
    usageRows,
    usageFails,
    successRate: validated > 0 ? ((100 * totalOk) / validated).toFixed(1) : 'n/a',
  };
}

/**
 * @param {{ files: string[], totalEntries: number, skippedNoBody: number, skippedNonConnect: number, base64Bodies: number, insightBilling: number, insightTokens: number, insightContext: number, insightAgent: number }} report
 * @param {ProtoJsonlReportSummary} summary
 * @returns {string}
 */
export function renderProtoJsonlReport(report, summary) {
  const lines = [[
    'Method:direction'.padEnd(42),
    'OK'.padStart(5),
    'FAIL'.padStart(5),
    'JSON'.padStart(5),
    'TOTAL'.padStart(6),
  ].join(' '), '-'.repeat(68)];

  for (const [key, stats] of summary.rows) {
    const total = stats.ok + stats.fail + stats.json;
    if (total === 0) {
      continue;
    }
    const mark = stats.fail > 0 ? '!' : ' ';
    lines.push(
      `${mark}${key.padEnd(41)} ${String(stats.ok).padStart(5)} ${String(stats.fail).padStart(5)} ${String(stats.json).padStart(5)} ${String(total).padStart(6)}`
    );
  }

  lines.push(
    '-'.repeat(68),
    [
      `TOTAL`.padEnd(42),
      String(summary.totalOk).padStart(5),
      String(summary.totalFail).padStart(5),
      String(summary.totalJson).padStart(5),
      String(summary.totalOk + summary.totalFail + summary.totalJson).padStart(6),
    ].join(' '),
    `\nLog files: ${report.files.length}, Connect RPC entries: ${report.totalEntries}, empty body: ${report.skippedNoBody}, non-RPC skipped: ${report.skippedNonConnect}, base64 bodies: ${report.base64Bodies}`,
    `Insights extracted: billing=${report.insightBilling}, tokens=${report.insightTokens}, context=${report.insightContext}, agent=${report.insightAgent}`,
  );

  if (summary.failures.length > 0) {
    lines.push('\n## Failures / notes (sample)\n');
    for (const [key, stats] of summary.failures.slice(0, 25)) {
      lines.push(`### ${key}`);
      for (const sample of stats.samples) {
        lines.push(`  - ${sample}`);
      }
    }
  }

  lines.push(
    `\nDecode/validation rate (excl. JSON-only counted separately): ${summary.successRate}% OK among proto+JSON validated (${summary.totalOk} ok, ${summary.totalFail} fail). JSON Connect entries: ${summary.totalJson}.`,
    '\n## Billing / dashboard RPCs (any direction)\n'
  );
  for (const row of summary.usageRows) {
    lines.push(`  ${row.method}: ${row.ok}/${row.total} OK (${row.percentage}%)`);
  }
  return lines.join('\n');
}
