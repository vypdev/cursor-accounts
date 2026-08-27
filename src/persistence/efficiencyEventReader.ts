import { escapeSqlString, sqlLiteral } from './sqliteExecutor';
import type { SqliteExecutor } from './sqliteExecutor';
import type { PromptEventRecord } from './types';

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

/** Reads individual efficiency events from the SQLite adapter. */
export interface EfficiencyEventReader {
  getEventsByRepository(
    profileId: string,
    repoPath: string
  ): Promise<PromptEventRecord[]>;
  getEventsByBranch(
    profileId: string,
    repoPath: string,
    branch: string
  ): Promise<PromptEventRecord[]>;
  getEventsWithQuota(
    profileId: string,
    options?: EfficiencyEventQueryOptions
  ): Promise<PromptEventRecord[]>;
  getEventsByQuotaPhase(
    profileId: string,
    phase: 'start' | 'mid' | 'end'
  ): Promise<PromptEventRecord[]>;
}

/** Creates the individual-event read boundary for one SQLite executor. */
export function createEfficiencyEventReader(
  executor: SqliteExecutor
): EfficiencyEventReader {
  return {
    getEventsByRepository: (profileId, repoPath) =>
      getEventsByRepository(executor, profileId, repoPath),
    getEventsByBranch: (profileId, repoPath, branch) =>
      getEventsByBranch(executor, profileId, repoPath, branch),
    getEventsWithQuota: (profileId, options) =>
      getEventsWithQuota(executor, profileId, options),
    getEventsByQuotaPhase: (profileId, phase) =>
      getEventsByQuotaPhase(executor, profileId, phase),
  };
}

async function getEventsByRepository(
  executor: SqliteExecutor,
  profileId: string,
  repoPath: string
): Promise<PromptEventRecord[]> {
  return getEventsWithQuota(executor, profileId, {
    repositoryPath: repoPath,
  });
}

async function getEventsByBranch(
  executor: SqliteExecutor,
  profileId: string,
  repoPath: string,
  branch: string
): Promise<PromptEventRecord[]> {
  return getEventsWithQuota(executor, profileId, {
    repositoryPath: repoPath,
    branchName: branch,
  });
}

async function getEventsWithQuota(
  executor: SqliteExecutor,
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

  const rows = executor.queryRows<PromptEventRow>(`
SELECT * FROM prompt_events
WHERE ${clauses.join(' AND ')}
ORDER BY timestamp DESC${limitClause};
`);

  return rows.map(rowToRecord);
}

async function getEventsByQuotaPhase(
  executor: SqliteExecutor,
  profileId: string,
  phase: 'start' | 'mid' | 'end'
): Promise<PromptEventRecord[]> {
  const [minPercent, maxPercent] =
    phase === 'start'
      ? [0, 33]
      : phase === 'mid'
        ? [34, 66]
        : [67, 100];

  return getEventsWithQuota(executor, profileId, {
    minQuotaPercent: minPercent,
    maxQuotaPercent: maxPercent,
  });
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
