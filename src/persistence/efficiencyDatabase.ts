import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  EfficiencyStats,
  RepositoryEfficiencyStats,
} from '@cursor-accounts/types';
import {
  createEmptyEfficiencyStats,
  EFFICIENCY_SCORE_THRESHOLD,
} from '@cursor-accounts/types';
import * as extensionLog from '../logging/extensionLog';
import { DatabaseMigrator } from './databaseMigrations';
import type {
  SqliteExecutor} from './sqliteExecutor';
import {
  escapeSqlString,
  sqlLiteral,
  sqlNumber
} from './sqliteExecutor';
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

function normalizeEpoch(value: number): number {
  if (!Number.isFinite(value)) {
    return Math.floor(Date.now() / 1000);
  }
  return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
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

export class EfficiencyDatabase {
  private readonly migrator: DatabaseMigrator;
  private readonly executor: SqliteExecutor;

  constructor(
    private readonly dbPath: string,
    extensionPath: string
  ) {
    this.migrator = new DatabaseMigrator(dbPath, extensionPath);
    this.executor = this.migrator.getExecutor();
  }

  async initialize(): Promise<void> {
    const exists = await this.executor.dbExists();

    if (!exists) {
      await this.createFresh();
      return;
    }

    try {
      const migrations = await this.migrator.loadMigrations();
      const currentVersion = await this.migrator.getCurrentVersion();
      const targetVersion = this.migrator.getTargetVersion(migrations);

      if (currentVersion > targetVersion) {
        extensionLog.warn(
          `[EfficiencyDatabase] DB version ${currentVersion} is newer than extension version ${targetVersion}. Using as-is.`
        );
        return;
      }

      if (currentVersion < targetVersion) {
        const result = await this.migrator.migrate();
        if (!result.success) {
          throw new Error(`Migration failed: ${result.error ?? 'unknown'}`);
        }
        extensionLog.info(
          `[EfficiencyDatabase] Migrated from v${result.fromVersion} to v${result.toVersion}`
        );
      }

      const validation = await this.migrator.validate();
      if (!validation.valid) {
        throw new Error(`Schema validation failed: ${validation.error}`);
      }
    } catch (error) {
      extensionLog.error(
        `[EfficiencyDatabase] Initialization failed: ${extensionLog.formatError(error)}. Recreating database.`
      );
      await this.fallbackRecreate();
    }
  }

  private async createFresh(): Promise<void> {
    const migrations = await this.migrator.loadMigrations();
    const first = migrations[0];
    if (!first) {
      throw new Error('No migration files found');
    }
    await this.migrator.applyInitialMigration(first);
    extensionLog.info(
      `[EfficiencyDatabase] Created fresh database v${first.version} using ${first.filename}`
    );
  }

  private async fallbackRecreate(): Promise<void> {
    const timestamp = Date.now();
    const backupPath = `${this.dbPath}.corrupted-${timestamp}`;

    try {
      await fs.rename(this.dbPath, backupPath);
      extensionLog.info(
        `[EfficiencyDatabase] Corrupted DB backed up to ${backupPath}`
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw new Error(
          `Cannot preserve corrupted efficiency database at ${backupPath}: ${extensionLog.formatError(error)}`
        );
      }
    }

    // WAL and shared-memory sidecars belong to the same database snapshot.
    // Moving only the main file and deleting these artifacts can discard
    // committed WAL pages and makes the backup impossible to restore.
    for (const suffix of ['-wal', '-shm']) {
      const sourcePath = `${this.dbPath}${suffix}`;
      const sidecarBackupPath = `${backupPath}${suffix}`;
      try {
        await fs.rename(sourcePath, sidecarBackupPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          throw new Error(
            `Cannot preserve corrupted efficiency database sidecar at ${sidecarBackupPath}: ${extensionLog.formatError(error)}`
          );
        }
      }
    }

    await this.createFresh();
  }

  async insertEvent(event: PromptEventRecord): Promise<void> {
    const sql = `
INSERT INTO prompt_events (
  profile_id, timestamp, prompt_text, model_used, efficiency_score,
  severity, confidence, task_type, repository_path, branch_name,
  conversation_id, scored_at, required_tier, actual_tier,
  recommended_model, opinion, quota_percent_used, quota_limit,
  quota_remaining, quota_cycle_start, quota_cycle_end, quota_is_enterprise
) VALUES (
  ${sqlLiteral(event.profileId)},
  ${sqlNumber(normalizeEpoch(event.timestamp))},
  ${sqlLiteral(event.promptText)},
  ${sqlLiteral(event.modelUsed)},
  ${sqlNumber(event.efficiencyScore)},
  ${sqlLiteral(event.severity)},
  ${sqlNumber(event.confidence)},
  ${sqlLiteral(event.taskType)},
  ${sqlLiteral(event.repositoryPath)},
  ${sqlLiteral(event.branchName)},
  ${sqlLiteral(event.conversationId)},
  ${sqlNumber(normalizeEpoch(event.scoredAt))},
  ${sqlNumber(event.requiredTier)},
  ${sqlNumber(event.actualTier)},
  ${sqlLiteral(event.recommendedModel)},
  ${sqlLiteral(event.opinion)},
  ${sqlNumber(event.quotaPercentUsed)},
  ${sqlNumber(event.quotaLimit)},
  ${sqlNumber(event.quotaRemaining)},
  ${sqlNumber(event.quotaCycleStart)},
  ${sqlNumber(event.quotaCycleEnd)},
  ${event.quotaIsEnterprise ? 1 : 0}
);
`.trim();

    await this.executor.runStatement(sql);
  }

  async getAggregatedStats(profileId: string): Promise<EfficiencyStats> {
    await Promise.resolve();
    const pid = escapeSqlString(profileId);
    const threshold = EFFICIENCY_SCORE_THRESHOLD;

    const totals = this.executor.queryRows<CountRow>(`
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN efficiency_score >= ${threshold} THEN 1 ELSE 0 END) AS efficient,
  SUM(CASE WHEN efficiency_score < ${threshold} THEN 1 ELSE 0 END) AS inefficient,
  MAX(timestamp) AS last_ts
FROM prompt_events
WHERE profile_id = '${pid}';
`);

    const totalRow = totals[0];
    if (!totalRow || totalRow.total === 0) {
      return createEmptyEfficiencyStats(profileId);
    }

    const repoRows = this.executor.queryRows<RepoAggRow>(`
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

    const branchRows = this.executor.queryRows<BranchAggRow>(`
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

    const byRepository: Record<string, RepositoryEfficiencyStats> = {};

    for (const repo of repoRows) {
      byRepository[repo.repository_path] = {
        repositoryPath: repo.repository_path,
        totalPrompts: repo.total,
        efficientPrompts: repo.efficient,
        inefficientPrompts: repo.inefficient,
        lastAnalyzed: isoFromStoredTimestamp(repo.last_ts),
        byBranch: {},
      };
    }

    for (const branch of branchRows) {
      const repo =
        byRepository[branch.repository_path] ??
        ({
          repositoryPath: branch.repository_path,
          totalPrompts: 0,
          efficientPrompts: 0,
          inefficientPrompts: 0,
          lastAnalyzed: isoFromStoredTimestamp(branch.last_ts),
          byBranch: {},
        } satisfies RepositoryEfficiencyStats);

      repo.byBranch[branch.branch_name] = {
        branchName: branch.branch_name,
        totalPrompts: branch.total,
        efficientPrompts: branch.efficient,
        inefficientPrompts: branch.inefficient,
        lastAnalyzed: isoFromStoredTimestamp(branch.last_ts),
      };
      byRepository[branch.repository_path] = repo;
    }

    return {
      profileId,
      totalPrompts: totalRow.total,
      efficientPrompts: totalRow.efficient,
      inefficientPrompts: totalRow.inefficient,
      lastUpdated: isoFromStoredTimestamp(totalRow.last_ts),
      byRepository,
    };
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
    options?: {
      minQuotaPercent?: number;
      maxQuotaPercent?: number;
      repositoryPath?: string;
      branchName?: string;
      fromTimestamp?: number;
      toTimestamp?: number;
      limit?: number;
    }
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

  async deleteOldEvents(
    profileId: string,
    beforeTimestamp: number
  ): Promise<number> {
    const pid = escapeSqlString(profileId);
    const countRows = this.executor.queryRows<{ count: number }>(`
SELECT COUNT(*) AS count FROM prompt_events
WHERE profile_id = '${pid}' AND timestamp < ${beforeTimestamp};
`);
    const count = countRows[0]?.count ?? 0;

    if (count > 0) {
      await this.executor.runStatement(`
DELETE FROM prompt_events
WHERE profile_id = '${pid}' AND timestamp < ${beforeTimestamp};
`);
    }

    return count;
  }

  async deleteAllEvents(profileId: string): Promise<void> {
    const pid = escapeSqlString(profileId);
    await this.executor.runStatement(`
DELETE FROM prompt_events WHERE profile_id = '${pid}';
`);
  }

  async vacuum(): Promise<void> {
    await this.executor.runScript(`
VACUUM;
PRAGMA wal_checkpoint(TRUNCATE);
`);
  }

  async getDatabaseSize(): Promise<number> {
    let total = 0;
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        const stat = await fs.stat(`${this.dbPath}${suffix}`);
        total += stat.size;
      } catch {
        // missing sidecar
      }
    }
    return total;
  }

  async destroyDatabase(): Promise<void> {
    await fs.unlink(this.dbPath).catch(() => {});
    await fs.unlink(`${this.dbPath}-wal`).catch(() => {});
    await fs.unlink(`${this.dbPath}-shm`).catch(() => {});
  }

  getDbPath(): string {
    return this.dbPath;
  }
}

export function getEfficiencyDbPath(userDataDir: string): string {
  return path.join(
    userDataDir,
    'User',
    'globalStorage',
    'cursor-accounts-efficiency.db'
  );
}
