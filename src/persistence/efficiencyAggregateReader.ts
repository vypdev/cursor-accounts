import type {
  EfficiencyStats,
  RepositoryEfficiencyStats,
} from '@cursor-accounts/types';
import {
  createEmptyEfficiencyStats,
  EFFICIENCY_SCORE_THRESHOLD,
} from '@cursor-accounts/types';
import { escapeSqlString } from './sqliteExecutor';
import type { SqliteExecutor } from './sqliteExecutor';

interface CountRow {
  total: number;
  efficient: number;
  inefficient: number;
  last_ts: number | null;
}

interface RepoAggRow {
  repository_path: string;
  total: number;
  efficient: number;
  inefficient: number;
  last_ts: number | null;
}

interface BranchAggRow {
  repository_path: string;
  branch_name: string;
  total: number;
  efficient: number;
  inefficient: number;
  last_ts: number | null;
}

export interface EfficiencyAggregateReader {
  getAggregatedStats(profileId: string): Promise<EfficiencyStats>;
}

/** Creates the aggregate-read boundary for one SQLite executor. */
export function createEfficiencyAggregateReader(
  executor: SqliteExecutor
): EfficiencyAggregateReader {
  return {
    getAggregatedStats: (profileId) =>
      getAggregatedStats(executor, profileId),
  };
}

async function getAggregatedStats(
  executor: SqliteExecutor,
  profileId: string
): Promise<EfficiencyStats> {
  await Promise.resolve();
  const threshold = EFFICIENCY_SCORE_THRESHOLD;
  const totalRow = queryProfileTotals(executor, profileId, threshold);
  if (!totalRow || totalRow.total === 0) {
    return createEmptyEfficiencyStats(profileId);
  }

  return buildEfficiencyStats(
    profileId,
    totalRow,
    queryRepositoryAggregates(executor, profileId, threshold),
    queryBranchAggregates(executor, profileId, threshold)
  );
}

function queryProfileTotals(
  executor: SqliteExecutor,
  profileId: string,
  threshold: number
): CountRow | undefined {
  const pid = escapeSqlString(profileId);
  return executor.queryRows<CountRow>(`
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN efficiency_score >= ${threshold} THEN 1 ELSE 0 END) AS efficient,
  SUM(CASE WHEN efficiency_score < ${threshold} THEN 1 ELSE 0 END) AS inefficient,
  MAX(timestamp) AS last_ts
FROM prompt_events
WHERE profile_id = '${pid}';
`)[0];
}

function queryRepositoryAggregates(
  executor: SqliteExecutor,
  profileId: string,
  threshold: number
): RepoAggRow[] {
  const pid = escapeSqlString(profileId);
  return executor.queryRows<RepoAggRow>(`
SELECT
  repository_path,
  COUNT(*) AS total,
  SUM(CASE WHEN efficiency_score >= ${threshold} THEN 1 ELSE 0 END) AS efficient,
  SUM(CASE WHEN efficiency_score < ${threshold} THEN 1 ELSE 0 END) AS inefficient,
  MAX(timestamp) AS last_ts
FROM prompt_events
WHERE profile_id = '${pid}' AND repository_path IS NOT NULL
GROUP BY repository_path;
`);
}

function queryBranchAggregates(
  executor: SqliteExecutor,
  profileId: string,
  threshold: number
): BranchAggRow[] {
  const pid = escapeSqlString(profileId);
  return executor.queryRows<BranchAggRow>(`
SELECT
  repository_path,
  branch_name,
  COUNT(*) AS total,
  SUM(CASE WHEN efficiency_score >= ${threshold} THEN 1 ELSE 0 END) AS efficient,
  SUM(CASE WHEN efficiency_score < ${threshold} THEN 1 ELSE 0 END) AS inefficient,
  MAX(timestamp) AS last_ts
FROM prompt_events
WHERE profile_id = '${pid}'
  AND repository_path IS NOT NULL
  AND branch_name IS NOT NULL
GROUP BY repository_path, branch_name;
`);
}

function buildEfficiencyStats(
  profileId: string,
  total: CountRow,
  repositoryRows: readonly RepoAggRow[],
  branchRows: readonly BranchAggRow[]
): EfficiencyStats {
  const byRepository = buildRepositoryStats(repositoryRows);
  addBranchStats(byRepository, branchRows);

  return {
    profileId,
    totalPrompts: total.total,
    efficientPrompts: total.efficient,
    inefficientPrompts: total.inefficient,
    lastUpdated: isoFromStoredTimestamp(total.last_ts),
    byRepository,
  };
}

function buildRepositoryStats(
  rows: readonly RepoAggRow[]
): Record<string, RepositoryEfficiencyStats> {
  const byRepository: Record<string, RepositoryEfficiencyStats> = {};
  for (const row of rows) {
    byRepository[row.repository_path] = {
      repositoryPath: row.repository_path,
      totalPrompts: row.total,
      efficientPrompts: row.efficient,
      inefficientPrompts: row.inefficient,
      lastAnalyzed: isoFromStoredTimestamp(row.last_ts),
      byBranch: {},
    };
  }
  return byRepository;
}

function addBranchStats(
  byRepository: Record<string, RepositoryEfficiencyStats>,
  rows: readonly BranchAggRow[]
): void {
  for (const row of rows) {
    const repository =
      byRepository[row.repository_path] ??
      createEmptyRepositoryStats(row.repository_path, row.last_ts);

    repository.byBranch[row.branch_name] = {
      branchName: row.branch_name,
      totalPrompts: row.total,
      efficientPrompts: row.efficient,
      inefficientPrompts: row.inefficient,
      lastAnalyzed: isoFromStoredTimestamp(row.last_ts),
    };
    byRepository[row.repository_path] = repository;
  }
}

function createEmptyRepositoryStats(
  repositoryPath: string,
  lastTimestamp: number | null
): RepositoryEfficiencyStats {
  return {
    repositoryPath,
    totalPrompts: 0,
    efficientPrompts: 0,
    inefficientPrompts: 0,
    lastAnalyzed: isoFromStoredTimestamp(lastTimestamp),
    byBranch: {},
  };
}

function isoFromStoredTimestamp(ts: number | null | undefined): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) {
    return new Date().toISOString();
  }
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toISOString();
}
