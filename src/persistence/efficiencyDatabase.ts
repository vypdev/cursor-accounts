import * as path from 'path';
import type { EfficiencyStats } from '@cursor-accounts/types';
import { DatabaseMigrator } from './databaseMigrations';
import { EfficiencyDatabaseLifecycle } from './efficiencyDatabaseLifecycle';
import { escapeSqlString, sqlLiteral, sqlNumber } from './sqliteExecutor';
import type { SqliteExecutor } from './sqliteExecutor';
import {
  createEfficiencyEventReader,
  type EfficiencyEventQueryOptions,
  type EfficiencyEventReader,
} from './efficiencyEventReader';
import {
  createEfficiencyAggregateReader,
  type EfficiencyAggregateReader,
} from './efficiencyAggregateReader';
import {
  createEfficiencyQuotaReader,
  type EfficiencyQuotaReader,
} from './efficiencyQuotaReader';
import type {
  PromptEventRecord,
  QuotaBucketAggregate,
  QuotaEfficiencyAggregate,
} from './types';

function normalizeEpoch(value: number): number {
  if (!Number.isFinite(value)) {
    return Math.floor(Date.now() / 1000);
  }
  return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
}

export class EfficiencyDatabase {
  private readonly migrator: DatabaseMigrator;
  private readonly executor: SqliteExecutor;
  private readonly lifecycle: EfficiencyDatabaseLifecycle;
  private readonly eventReader: EfficiencyEventReader;
  private readonly aggregateReader: EfficiencyAggregateReader;
  private readonly quotaReader: EfficiencyQuotaReader;

  constructor(
    private readonly dbPath: string,
    extensionPath: string
  ) {
    this.migrator = new DatabaseMigrator(dbPath, extensionPath);
    this.executor = this.migrator.getExecutor();
    this.lifecycle = new EfficiencyDatabaseLifecycle({
      dbPath,
      executor: this.executor,
      migrator: this.migrator,
    });
    this.eventReader = createEfficiencyEventReader(this.executor);
    this.aggregateReader = createEfficiencyAggregateReader(this.executor);
    this.quotaReader = createEfficiencyQuotaReader(this.executor);
  }

  async initialize(): Promise<void> {
    await this.lifecycle.initialize();
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
    return this.aggregateReader.getAggregatedStats(profileId);
  }

  async getEventsByRepository(
    profileId: string,
    repoPath: string
  ): Promise<PromptEventRecord[]> {
    return this.eventReader.getEventsByRepository(profileId, repoPath);
  }

  async getEventsByBranch(
    profileId: string,
    repoPath: string,
    branch: string
  ): Promise<PromptEventRecord[]> {
    return this.eventReader.getEventsByBranch(profileId, repoPath, branch);
  }

  async getEventsWithQuota(
    profileId: string,
    options?: EfficiencyEventQueryOptions
  ): Promise<PromptEventRecord[]> {
    return this.eventReader.getEventsWithQuota(profileId, options);
  }

  async getEventsByQuotaPhase(
    profileId: string,
    phase: 'start' | 'mid' | 'end'
  ): Promise<PromptEventRecord[]> {
    return this.eventReader.getEventsByQuotaPhase(profileId, phase);
  }

  async getEfficiencyByQuotaRange(
    profileId: string,
    minPercent: number,
    maxPercent: number
  ): Promise<QuotaEfficiencyAggregate> {
    return this.quotaReader.getEfficiencyByQuotaRange(
      profileId,
      minPercent,
      maxPercent
    );
  }

  async getEfficiencyTrendByQuota(
    profileId: string,
    bucketSize = 10
  ): Promise<QuotaBucketAggregate[]> {
    return this.quotaReader.getEfficiencyTrendByQuota(profileId, bucketSize);
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
    return this.lifecycle.getDatabaseSize();
  }

  async destroyDatabase(): Promise<void> {
    await this.lifecycle.destroyDatabase();
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
