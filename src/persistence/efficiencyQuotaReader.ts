import { escapeSqlString } from './sqliteExecutor';
import type { SqliteExecutor } from './sqliteExecutor';
import type { QuotaBucketAggregate, QuotaEfficiencyAggregate } from './types';

/** Reads quota-based efficiency projections. */
export interface EfficiencyQuotaReader {
  getEfficiencyByQuotaRange(
    profileId: string,
    minPercent: number,
    maxPercent: number
  ): Promise<QuotaEfficiencyAggregate>;
  getEfficiencyTrendByQuota(
    profileId: string,
    bucketSize?: number
  ): Promise<QuotaBucketAggregate[]>;
}

/** Creates the quota-projection read boundary for one SQLite executor. */
export function createEfficiencyQuotaReader(
  executor: SqliteExecutor
): EfficiencyQuotaReader {
  return {
    getEfficiencyByQuotaRange: (profileId, minPercent, maxPercent) =>
      getEfficiencyByQuotaRange(executor, profileId, minPercent, maxPercent),
    getEfficiencyTrendByQuota: (profileId, bucketSize) =>
      getEfficiencyTrendByQuota(executor, profileId, bucketSize),
  };
}

async function getEfficiencyByQuotaRange(
  executor: SqliteExecutor,
  profileId: string,
  minPercent: number,
  maxPercent: number
): Promise<QuotaEfficiencyAggregate> {
  await Promise.resolve();
  const pid = escapeSqlString(profileId);
  const rows = executor.queryRows<{
      avg_efficiency: number;
      count: number;
  }>(`
SELECT
  AVG(efficiency_score) AS avg_efficiency,
  COUNT(*) AS count
FROM prompt_events
WHERE profile_id = '${pid}'
  AND quota_percent_used IS NOT NULL
  AND quota_percent_used >= ${minPercent}
  AND quota_percent_used <= ${maxPercent};
`);

  const row = rows[0];
  return {
    avgEfficiency: row?.avg_efficiency ?? 0,
    count: row?.count ?? 0,
  };
}

async function getEfficiencyTrendByQuota(
  executor: SqliteExecutor,
  profileId: string,
  bucketSize = 10
): Promise<QuotaBucketAggregate[]> {
  await Promise.resolve();
  const pid = escapeSqlString(profileId);
  const size = Math.max(1, bucketSize);

  const rows = executor.queryRows<{
      quota_bucket: number;
      avg_efficiency: number;
      count: number;
    }>(`
SELECT
  CAST(quota_percent_used / ${size} AS INTEGER) * ${size} AS quota_bucket,
  AVG(efficiency_score) AS avg_efficiency,
  COUNT(*) AS count
FROM prompt_events
WHERE profile_id = '${pid}' AND quota_percent_used IS NOT NULL
GROUP BY quota_bucket
ORDER BY quota_bucket;
`);

  return rows.map((row) => ({
    quotaBucket: row.quota_bucket,
    avgEfficiency: row.avg_efficiency,
    count: row.count,
  }));
}
