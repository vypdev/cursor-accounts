import type {
  EfficiencyStats,
  RepositoryEfficiencyStats,
} from '@cursor-accounts/types';
import {
  createEmptyEfficiencyStats,
  EFFICIENCY_SCORE_THRESHOLD,
} from '@cursor-accounts/types';
import {
  escapeSqlString,
  sqlLiteral,
} from './sqliteExecutor';
import type { SqliteExecutor } from './sqliteExecutor';
import type {
  PromptEventRecord,
  QuotaBucketAggregate,
  QuotaEfficiencyAggregate,
} from './types';

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

interface PromptEventRow {
  id: number;
  profile_id: string;
  timestamp: number;
  prompt_text: string;
  model_used: string;
  efficiency_score: number;
  severity: string;
  confidence: number;
  task_type: string;
  repository_path: string | null;
  branch_name: string | null;
  conversation_id: string | null;
  scored_at: number | null;
  required_tier: number | null;
  actual_tier: number | null;
  recommended_model: string | null;
  opinion: string | null;
  quota_percent_used: number | null;
  quota_limit: number | null;
  quota_remaining: number | null;
  quota_cycle_start: number | null;
  quota_cycle_end: number | null;
  quota_is_enterprise: number | null;
  created_at: number;
}

export interface EfficiencyEventQueryOptions {
  minQuotaPercent?: number;
  maxQuotaPercent?: number;
  repositoryPath?: string;
  branchName?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
}

/** Reads efficiency events and builds application-facing statistics. */
export class EfficiencyDatabaseQueryReader {
  constructor(private readonly executor: SqliteExecutor) {}

  async getAggregatedStats(profileId: string): Promise<EfficiencyStats> {
    await Promise.resolve();
    const threshold = EFFICIENCY_SCORE_THRESHOLD;
    const totalRow = this.queryProfileTotals(profileId, threshold);
    if (!totalRow || totalRow.total === 0) {
      return createEmptyEfficiencyStats(profileId);
    }

    return buildEfficiencyStats(
      profileId,
      totalRow,
      this.queryRepositoryAggregates(profileId, threshold),
      this.queryBranchAggregates(profileId, threshold)
    );
  }

  async getEventsByRepository(
    profileId: string,
    repoPath: string
  ): Promise<PromptEventRecord[]> {
    return this.getEventsWithQuota(profileId, {
      repositoryPath: repoPath,
    });
  }

  async getEventsByBranch(
    profileId: string,
    repoPath: string,
    branch: string
  ): Promise<PromptEventRecord[]> {
    return this.getEventsWithQuota(profileId, {
      repositoryPath: repoPath,
      branchName: branch,
    });
  }

  async getEventsWithQuota(
    profileId: string,
    options?: EfficiencyEventQueryOptions
  ): Promise<PromptEventRecord[]> {
    await Promise.resolve();
    const pid = escapeSqlString(profileId);
    const clauses = [`profile_id = '${pid}'`];

    if (options?.minQuotaPercent !== undefined) {
      clauses.push(`quota_percent_used >= ${options.minQuotaPercent}`);
    }
    if (options?.maxQuotaPercent !== undefined) {
      clauses.push(`quota_percent_used <= ${options.maxQuotaPercent}`);
    }
    if (options?.repositoryPath) {
      clauses.push(`repository_path = ${sqlLiteral(options.repositoryPath)}`);
    }
    if (options?.branchName) {
      clauses.push(`branch_name = ${sqlLiteral(options.branchName)}`);
    }
    if (options?.fromTimestamp !== undefined) {
      clauses.push(`timestamp >= ${options.fromTimestamp}`);
    }
    if (options?.toTimestamp !== undefined) {
      clauses.push(`timestamp <= ${options.toTimestamp}`);
    }

    const limitClause =
      options?.limit !== undefined ? ` LIMIT ${Math.max(0, options.limit)}` : '';

    const rows = this.executor.queryRows<PromptEventRow>(`
SELECT * FROM prompt_events
WHERE ${clauses.join(' AND ')}
ORDER BY timestamp DESC${limitClause};
`);

    return rows.map(rowToRecord);
  }

  async getEventsByQuotaPhase(
    profileId: string,
    phase: 'start' | 'mid' | 'end'
  ): Promise<PromptEventRecord[]> {
    const [minPercent, maxPercent] =
      phase === 'start'
        ? [0, 33]
        : phase === 'mid'
          ? [34, 66]
          : [67, 100];

    return this.getEventsWithQuota(profileId, {
      minQuotaPercent: minPercent,
      maxQuotaPercent: maxPercent,
    });
  }

  async getEfficiencyByQuotaRange(
    profileId: string,
    minPercent: number,
    maxPercent: number
  ): Promise<QuotaEfficiencyAggregate> {
    await Promise.resolve();
    const pid = escapeSqlString(profileId);
    const rows = this.executor.queryRows<{
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

  async getEfficiencyTrendByQuota(
    profileId: string,
    bucketSize = 10
  ): Promise<QuotaBucketAggregate[]> {
    await Promise.resolve();
    const pid = escapeSqlString(profileId);
    const size = Math.max(1, bucketSize);

    const rows = this.executor.queryRows<{
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

  private queryProfileTotals(
    profileId: string,
    threshold: number
  ): CountRow | undefined {
    const pid = escapeSqlString(profileId);
    return this.executor.queryRows<CountRow>(`
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN efficiency_score >= ${threshold} THEN 1 ELSE 0 END) AS efficient,
  SUM(CASE WHEN efficiency_score < ${threshold} THEN 1 ELSE 0 END) AS inefficient,
  MAX(timestamp) AS last_ts
FROM prompt_events
WHERE profile_id = '${pid}';
`)[0];
  }

  private queryRepositoryAggregates(
    profileId: string,
    threshold: number
  ): RepoAggRow[] {
    const pid = escapeSqlString(profileId);
    return this.executor.queryRows<RepoAggRow>(`
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

  private queryBranchAggregates(
    profileId: string,
    threshold: number
  ): BranchAggRow[] {
    const pid = escapeSqlString(profileId);
    return this.executor.queryRows<BranchAggRow>(`
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

function rowToRecord(row: PromptEventRow): PromptEventRecord {
  return {
    profileId: row.profile_id,
    timestamp: row.timestamp,
    promptText: row.prompt_text,
    modelUsed: row.model_used,
    efficiencyScore: row.efficiency_score,
    severity: row.severity as PromptEventRecord['severity'],
    confidence: row.confidence,
    taskType: row.task_type as PromptEventRecord['taskType'],
    repositoryPath: row.repository_path ?? undefined,
    branchName: row.branch_name ?? undefined,
    conversationId: row.conversation_id ?? '',
    scoredAt: row.scored_at ?? row.timestamp,
    requiredTier: row.required_tier ?? 0,
    actualTier: row.actual_tier ?? 0,
    recommendedModel: row.recommended_model ?? '',
    opinion: row.opinion ?? '',
    quotaPercentUsed: row.quota_percent_used ?? undefined,
    quotaLimit: row.quota_limit ?? undefined,
    quotaRemaining: row.quota_remaining ?? undefined,
    quotaCycleStart: row.quota_cycle_start ?? undefined,
    quotaCycleEnd: row.quota_cycle_end ?? undefined,
    quotaIsEnterprise: row.quota_is_enterprise === 1,
  };
}
