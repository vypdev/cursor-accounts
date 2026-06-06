import * as fs from 'fs/promises';
import type {
  AgentTokenBreakdown,
  IAgentTrackingRepository,
} from '../domain/ports/IAgentTrackingRepository';
import * as extensionLog from '../logging/extensionLog';
import { DatabaseMigrator } from './databaseMigrations';
import {
  escapeSqlString,
  sqlLiteral,
  sqlNumber,
  SqliteExecutor,
} from './sqliteExecutor';
import type {
  AgentRecord,
  AgentTreeNode,
  ConversationDeltaTotals,
  ConversationTokenTotals,
  TokenDeltaMinuteRecord,
  TokenSnapshotRecord,
  TurnEndedRecord,
} from './types';

interface AgentRow {
  request_id: string;
  conversation_id: string;
  conversation_group_id: string | null;
  parent_request_id: string | null;
  subagent_request_id: string | null;
  model_name: string | null;
  started_at: number;
  ended_at: number | null;
  is_eof: number;
  profile_id: string;
}

interface TreeRow {
  request_id: string;
  parent_request_id: string | null;
  model_name: string | null;
  started_at: number;
  ended_at: number | null;
  total_tokens: number;
}

interface TokenAggregateRow {
  peak_streaming: number | null;
  final_input: number | null;
  final_output: number | null;
  final_cache_read: number | null;
  final_cache_write: number | null;
  final_total: number | null;
}

interface ConversationTotalsRow {
  total_input: number;
  total_output: number;
  total_cache_read: number;
  total_cache_write: number;
  total: number;
  total_delta: number;
  total_delta_cost: number;
  total_turn_cost: number;
  latest_context_used: number | null;
  latest_context_max: number | null;
  delta_buckets: number;
  agent_count: number;
  started_at: number | null;
  ended_at: number | null;
  models: string | null;
}

interface TurnEndedRow {
  id: number;
  request_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  total_tokens: number | null;
  total_cents: number | null;
  usage_uuid: string | null;
  recorded_at: number;
  model_name: string | null;
  http_request_id: string | null;
}

interface DeltaTotalsRow {
  total_delta: number;
  total_cost: number;
  delta_buckets: number;
}

function coalesceNumber(value: number | null | undefined): number {
  return value ?? 0;
}

function buildAgentTree(rows: TreeRow[]): AgentTreeNode[] {
  const nodes = new Map<string, AgentTreeNode>();
  for (const row of rows) {
    nodes.set(row.request_id, {
      requestId: row.request_id,
      parentRequestId: row.parent_request_id ?? undefined,
      modelName: row.model_name ?? undefined,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      totalTokens: row.total_tokens,
      children: [],
    });
  }

  const roots: AgentTreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.parentRequestId;
    if (parentId && nodes.has(parentId)) {
      nodes.get(parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * SQLite implementation of {@link IAgentTrackingRepository}.
 */
export class AgentTrackingDatabase implements IAgentTrackingRepository {
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
    }

    try {
      const migrations = await this.migrator.loadMigrations();
      const currentVersion = await this.migrator.getCurrentVersion();
      const targetVersion = this.migrator.getTargetVersion(migrations);

      if (currentVersion > targetVersion) {
        extensionLog.warn(
          `[AgentTrackingDatabase] DB version ${currentVersion} is newer than extension version ${targetVersion}. Using as-is.`
        );
        return;
      }

      if (currentVersion < targetVersion) {
        const result = await this.migrator.migrate();
        if (!result.success) {
          throw new Error(`Migration failed: ${result.error ?? 'unknown'}`);
        }
        extensionLog.info(
          `[AgentTrackingDatabase] Migrated from v${result.fromVersion} to v${result.toVersion}`
        );
      }

      const validation = await this.migrator.validate();
      if (!validation.valid) {
        throw new Error(`Schema validation failed: ${validation.error}`);
      }
    } catch (error) {
      extensionLog.error(
        `[AgentTrackingDatabase] Initialization failed: ${extensionLog.formatError(error)}. Recreating database.`
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
      `[AgentTrackingDatabase] Created fresh database v${first.version} using ${first.filename}`
    );
  }

  private async fallbackRecreate(): Promise<void> {
    const timestamp = Date.now();
    const backupPath = `${this.dbPath}.corrupted-${timestamp}`;

    try {
      await fs.rename(this.dbPath, backupPath);
      extensionLog.info(
        `[AgentTrackingDatabase] Corrupted DB backed up to ${backupPath}`
      );
    } catch {
      await fs.unlink(this.dbPath).catch(() => {});
    }

    await fs.unlink(`${this.dbPath}-wal`).catch(() => {});
    await fs.unlink(`${this.dbPath}-shm`).catch(() => {});

    await this.createFresh();
  }

  async upsertConversation(
    conversationId: string,
    profileId: string,
    timestamp: number,
    messageCount?: number,
    workspacePath?: string,
    _repositoryPath?: string,
    _branchName?: string
  ): Promise<void> {
    const sql = `
INSERT INTO conversations (
  conversation_id, profile_id, created_at, last_activity, message_count, workspace_path
) VALUES (
  ${sqlLiteral(conversationId)},
  ${sqlLiteral(profileId)},
  ${timestamp},
  ${timestamp},
  ${messageCount != null ? sqlNumber(messageCount) : 'NULL'},
  ${sqlLiteral(workspacePath)}
)
ON CONFLICT(conversation_id) DO UPDATE SET
  last_activity = ${timestamp},
  message_count = COALESCE(${messageCount != null ? sqlNumber(messageCount) : 'NULL'}, message_count),
  workspace_path = COALESCE(excluded.workspace_path, conversations.workspace_path);
`.trim();
    await this.executor.runStatement(sql);
  }

  async upsertAgent(agent: AgentRecord): Promise<void> {
    const sql = `
INSERT INTO agents (
  request_id, conversation_id, conversation_group_id, parent_request_id,
  subagent_request_id, model_name, started_at, ended_at, is_eof, profile_id, workspace_path
) VALUES (
  ${sqlLiteral(agent.requestId)},
  ${sqlLiteral(agent.conversationId)},
  ${sqlLiteral(agent.conversationGroupId)},
  ${sqlLiteral(agent.parentRequestId)},
  ${sqlLiteral(agent.subagentRequestId)},
  ${sqlLiteral(agent.modelName)},
  ${agent.startedAt},
  ${agent.endedAt != null ? agent.endedAt : 'NULL'},
  ${agent.isEof ? 1 : 0},
  ${sqlLiteral(agent.profileId)},
  ${sqlLiteral(agent.workspacePath)}
)
ON CONFLICT(request_id) DO UPDATE SET
  conversation_id = excluded.conversation_id,
  conversation_group_id = COALESCE(excluded.conversation_group_id, conversation_group_id),
  parent_request_id = COALESCE(excluded.parent_request_id, parent_request_id),
  subagent_request_id = COALESCE(excluded.subagent_request_id, subagent_request_id),
  model_name = COALESCE(excluded.model_name, model_name),
  started_at = MIN(agents.started_at, excluded.started_at),
  ended_at = COALESCE(excluded.ended_at, agents.ended_at),
  is_eof = CASE WHEN excluded.is_eof = 1 THEN 1 ELSE agents.is_eof END,
  workspace_path = COALESCE(excluded.workspace_path, agents.workspace_path);
`.trim();
    await this.executor.runStatement(sql);
  }

  async insertTokenSnapshot(
    tokens: Omit<TokenSnapshotRecord, 'id'>
  ): Promise<void> {
    const sql = `
INSERT INTO agent_tokens (
  request_id, token_type, streaming_tokens, input_tokens, output_tokens,
  cache_read_tokens, cache_write_tokens, total_tokens, usage_uuid, recorded_at,
  model_name, turn_index, http_request_id, minute_bucket
) VALUES (
  ${sqlLiteral(tokens.requestId)},
  ${sqlLiteral(tokens.tokenType)},
  ${sqlNumber(tokens.streamingTokens)},
  ${sqlNumber(tokens.inputTokens)},
  ${sqlNumber(tokens.outputTokens)},
  ${sqlNumber(tokens.cacheReadTokens)},
  ${sqlNumber(tokens.cacheWriteTokens)},
  ${sqlNumber(tokens.totalTokens)},
  ${sqlLiteral(tokens.usageUuid)},
  ${tokens.recordedAt},
  ${sqlLiteral(tokens.modelName)},
  ${sqlNumber(tokens.turnIndex)},
  ${sqlLiteral(tokens.httpRequestId)},
  ${sqlNumber(tokens.minuteBucket)}
);
`.trim();
    await this.executor.runStatement(sql);
  }

  async upsertTokenDelta(delta: TokenDeltaMinuteRecord): Promise<void> {
    const recordedAt = delta.recordedAt ?? delta.minuteBucket;
    const sql = `
INSERT INTO agent_tokens (
  request_id, token_type, streaming_tokens, cost_cents,
  context_used_tokens, context_max_tokens,
  minute_bucket, recorded_at, model_name
) VALUES (
  ${sqlLiteral(delta.requestId)},
  'delta',
  ${sqlNumber(delta.streamingTokens)},
  ${delta.costCents != null ? delta.costCents : 'NULL'},
  ${sqlNumber(delta.contextUsedTokens)},
  ${sqlNumber(delta.contextMaxTokens)},
  ${delta.minuteBucket},
  ${recordedAt},
  ${sqlLiteral(delta.modelName)}
)
ON CONFLICT(request_id, minute_bucket) WHERE token_type = 'delta' AND minute_bucket IS NOT NULL
DO UPDATE SET
  streaming_tokens = COALESCE(agent_tokens.streaming_tokens, 0) + excluded.streaming_tokens,
  cost_cents = COALESCE(agent_tokens.cost_cents, 0) + COALESCE(excluded.cost_cents, 0),
  context_used_tokens = COALESCE(excluded.context_used_tokens, agent_tokens.context_used_tokens),
  context_max_tokens = COALESCE(excluded.context_max_tokens, agent_tokens.context_max_tokens),
  recorded_at = excluded.recorded_at,
  model_name = COALESCE(excluded.model_name, agent_tokens.model_name);
`.trim();
    try {
      await this.executor.runStatement(sql);
      extensionLog.info(
        `[AgentTracking] DB upsertTokenDelta ok bidi=${delta.requestId.slice(0, 8)}… ` +
          `bucket=${delta.minuteBucket} +${delta.streamingTokens} tokens`
      );
    } catch (error) {
      extensionLog.error(
        `[AgentTracking] DB upsertTokenDelta FAILED bidi=${delta.requestId.slice(0, 8)}… ` +
          `bucket=${delta.minuteBucket} increment=${delta.streamingTokens}: ` +
          `${extensionLog.formatError(error)}`
      );
      throw error;
    }
  }

  async insertTurnEnded(turnEnded: Omit<TurnEndedRecord, 'id'>): Promise<void> {
    const sql = `
INSERT INTO agent_turn_ended (
  request_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
  total_tokens, total_cents, usage_uuid, recorded_at, model_name, http_request_id
) VALUES (
  ${sqlLiteral(turnEnded.requestId)},
  ${turnEnded.inputTokens},
  ${turnEnded.outputTokens},
  ${sqlNumber(turnEnded.cacheReadTokens)},
  ${sqlNumber(turnEnded.cacheWriteTokens)},
  ${sqlNumber(turnEnded.totalTokens)},
  ${turnEnded.totalCents != null ? turnEnded.totalCents : 'NULL'},
  ${sqlLiteral(turnEnded.usageUuid)},
  ${turnEnded.recordedAt},
  ${sqlLiteral(turnEnded.modelName)},
  ${sqlLiteral(turnEnded.httpRequestId)}
);
`.trim();
    await this.executor.runStatement(sql);
  }

  async getTotalConversationTokens(
    conversationId: string
  ): Promise<ConversationTokenTotals> {
    const cid = escapeSqlString(conversationId);
    const rows = this.executor.queryRows<ConversationTotalsRow>(`
SELECT
  COALESCE(SUM(per_agent.input_tokens), 0) AS total_input,
  COALESCE(SUM(per_agent.output_tokens), 0) AS total_output,
  COALESCE(SUM(per_agent.cache_read_tokens), 0) AS total_cache_read,
  COALESCE(SUM(per_agent.cache_write_tokens), 0) AS total_cache_write,
  COALESCE(SUM(per_agent.total_tokens), 0) AS total,
  COALESCE(SUM(per_agent.delta_tokens), 0) AS total_delta,
  COALESCE(SUM(per_agent.delta_cost), 0) AS total_delta_cost,
  COALESCE(SUM(per_agent.turn_cost_cents), 0) AS total_turn_cost,
  (
    SELECT t.context_used_tokens
    FROM agent_tokens t
    JOIN agents a2 ON a2.request_id = t.request_id
    WHERE a2.conversation_id = '${cid}'
      AND t.token_type = 'delta'
      AND t.minute_bucket IS NOT NULL
      AND t.context_used_tokens IS NOT NULL
      AND t.context_max_tokens IS NOT NULL
    ORDER BY t.recorded_at DESC, t.id DESC
    LIMIT 1
  ) AS latest_context_used,
  (
    SELECT t.context_max_tokens
    FROM agent_tokens t
    JOIN agents a2 ON a2.request_id = t.request_id
    WHERE a2.conversation_id = '${cid}'
      AND t.token_type = 'delta'
      AND t.minute_bucket IS NOT NULL
      AND t.context_used_tokens IS NOT NULL
      AND t.context_max_tokens IS NOT NULL
    ORDER BY t.recorded_at DESC, t.id DESC
    LIMIT 1
  ) AS latest_context_max,
  COALESCE(SUM(per_agent.delta_buckets), 0) AS delta_buckets,
  COUNT(DISTINCT a.request_id) AS agent_count,
  MIN(a.started_at) AS started_at,
  MAX(COALESCE(a.ended_at, a.started_at)) AS ended_at,
  GROUP_CONCAT(DISTINCT a.model_name) AS models
FROM agents a
LEFT JOIN (
  SELECT
    a2.request_id,
    COALESCE(SUM(te.input_tokens), 0) AS input_tokens,
    COALESCE(SUM(te.output_tokens), 0) AS output_tokens,
    COALESCE(SUM(te.cache_read_tokens), 0) AS cache_read_tokens,
    COALESCE(SUM(te.cache_write_tokens), 0) AS cache_write_tokens,
    COALESCE(SUM(te.total_tokens), 0) AS total_tokens,
    COALESCE(SUM(te.total_cents), 0) AS turn_cost_cents,
    COALESCE(delta.delta_tokens, 0) AS delta_tokens,
    COALESCE(delta.delta_cost, 0) AS delta_cost,
    COALESCE(delta.delta_buckets, 0) AS delta_buckets
  FROM agents a2
  LEFT JOIN agent_turn_ended te ON te.request_id = a2.request_id
  LEFT JOIN (
    SELECT
      request_id,
      COALESCE(SUM(streaming_tokens), 0) AS delta_tokens,
      COALESCE(SUM(cost_cents), 0) AS delta_cost,
      COUNT(DISTINCT minute_bucket) AS delta_buckets
    FROM agent_tokens
    WHERE token_type = 'delta' AND minute_bucket IS NOT NULL
    GROUP BY request_id
  ) delta ON delta.request_id = a2.request_id
  GROUP BY a2.request_id
) per_agent ON a.request_id = per_agent.request_id
WHERE a.conversation_id = '${cid}';
`);

    const row = rows[0];
    return {
      totalInputTokens: coalesceNumber(row?.total_input),
      totalOutputTokens: coalesceNumber(row?.total_output),
      totalCacheReadTokens: coalesceNumber(row?.total_cache_read),
      totalCacheWriteTokens: coalesceNumber(row?.total_cache_write),
      totalTokens: coalesceNumber(row?.total),
      totalDeltaTokens: coalesceNumber(row?.total_delta),
      totalDeltaCostCents: coalesceNumber(row?.total_delta_cost),
      totalTurnCostCents: coalesceNumber(row?.total_turn_cost),
      latestContextUsedTokens: row?.latest_context_used ?? undefined,
      latestContextMaxTokens: row?.latest_context_max ?? undefined,
      deltaMinuteBuckets: coalesceNumber(row?.delta_buckets),
      agentCount: coalesceNumber(row?.agent_count),
      models: row?.models ? row.models.split(',').filter(Boolean) : [],
      startedAt: row?.started_at ?? 0,
      endedAt: row?.ended_at ?? 0,
    };
  }

  async getTotalDeltaTokensByConversation(
    conversationId: string
  ): Promise<ConversationDeltaTotals> {
    const cid = escapeSqlString(conversationId);
    const rows = this.executor.queryRows<DeltaTotalsRow>(`
SELECT
  COALESCE(SUM(t.streaming_tokens), 0) AS total_delta,
  COALESCE(SUM(t.cost_cents), 0) AS total_cost,
  COUNT(DISTINCT t.minute_bucket) AS delta_buckets
FROM agent_tokens t
JOIN agents a ON a.request_id = t.request_id
WHERE a.conversation_id = '${cid}'
  AND t.token_type = 'delta'
  AND t.minute_bucket IS NOT NULL;
`);

    const row = rows[0];
    return {
      totalStreamingTokens: coalesceNumber(row?.total_delta),
      totalCostCents: coalesceNumber(row?.total_cost),
      minuteBuckets: coalesceNumber(row?.delta_buckets),
    };
  }

  async getTurnEndedByConversation(
    conversationId: string
  ): Promise<TurnEndedRecord[]> {
    const cid = escapeSqlString(conversationId);
    const rows = this.executor.queryRows<TurnEndedRow>(`
SELECT
  te.id,
  te.request_id,
  te.input_tokens,
  te.output_tokens,
  te.cache_read_tokens,
  te.cache_write_tokens,
  te.total_tokens,
  te.total_cents,
  te.usage_uuid,
  te.recorded_at,
  te.model_name,
  te.http_request_id
FROM agent_turn_ended te
JOIN agents a ON a.request_id = te.request_id
WHERE a.conversation_id = '${cid}'
ORDER BY te.recorded_at DESC;
`);

    return rows.map((row) => ({
      id: row.id,
      requestId: row.request_id,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens ?? undefined,
      cacheWriteTokens: row.cache_write_tokens ?? undefined,
      totalTokens: row.total_tokens ?? undefined,
      totalCents: row.total_cents ?? undefined,
      usageUuid: row.usage_uuid ?? undefined,
      recordedAt: row.recorded_at,
      modelName: row.model_name ?? undefined,
      httpRequestId: row.http_request_id ?? undefined,
    }));
  }

  async getAgentTokens(requestId: string): Promise<AgentTokenBreakdown | null> {
    const rid = escapeSqlString(requestId);
    const agentRows = this.executor.queryRows<AgentRow>(`
SELECT * FROM agents WHERE request_id = '${rid}' LIMIT 1;
`);
    const agent = agentRows[0];
    if (!agent) {
      return null;
    }

    const tokenRows = this.executor.queryRows<TokenAggregateRow>(`
SELECT
  (
    SELECT COALESCE(
      NULLIF((
        SELECT COALESCE(SUM(streaming_tokens), 0)
        FROM agent_tokens
        WHERE request_id = '${rid}' AND token_type = 'delta' AND minute_bucket IS NOT NULL
      ), 0),
      (
        SELECT COALESCE(MAX(streaming_tokens), 0)
        FROM agent_tokens
        WHERE request_id = '${rid}' AND token_type = 'delta' AND minute_bucket IS NULL
      )
    )
  ) AS peak_streaming,
  (
    SELECT COALESCE(SUM(input_tokens), 0)
    FROM agent_turn_ended
    WHERE request_id = '${rid}'
  ) AS final_input,
  (
    SELECT COALESCE(SUM(output_tokens), 0)
    FROM agent_turn_ended
    WHERE request_id = '${rid}'
  ) AS final_output,
  (
    SELECT COALESCE(SUM(cache_read_tokens), 0)
    FROM agent_turn_ended
    WHERE request_id = '${rid}'
  ) AS final_cache_read,
  (
    SELECT COALESCE(SUM(cache_write_tokens), 0)
    FROM agent_turn_ended
    WHERE request_id = '${rid}'
  ) AS final_cache_write,
  (
    SELECT COALESCE(SUM(total_tokens), 0)
    FROM agent_turn_ended
    WHERE request_id = '${rid}'
  ) AS final_total;
`);

    const tokens = tokenRows[0];
    const finalInput = coalesceNumber(tokens?.final_input);
    const finalOutput = coalesceNumber(tokens?.final_output);
    const finalCacheRead = coalesceNumber(tokens?.final_cache_read);
    const finalCacheWrite = coalesceNumber(tokens?.final_cache_write);
    const billedTotal = finalInput + finalOutput + finalCacheRead + finalCacheWrite;

    return {
      requestId: agent.request_id,
      conversationId: agent.conversation_id,
      parentRequestId: agent.parent_request_id ?? undefined,
      modelName: agent.model_name ?? undefined,
      startedAt: agent.started_at,
      endedAt: agent.ended_at ?? undefined,
      peakStreamingTokens: coalesceNumber(tokens?.peak_streaming),
      finalInputTokens: finalInput,
      finalOutputTokens: finalOutput,
      finalCacheReadTokens: finalCacheRead,
      finalCacheWriteTokens: finalCacheWrite,
      finalTotalTokens:
        coalesceNumber(tokens?.final_total) > 0
          ? coalesceNumber(tokens?.final_total)
          : billedTotal,
    };
  }

  async getAgentTree(conversationId: string): Promise<AgentTreeNode[]> {
    const cid = escapeSqlString(conversationId);
    const rows = this.executor.queryRows<TreeRow>(`
SELECT
  a.request_id,
  a.parent_request_id,
  a.model_name,
  a.started_at,
  a.ended_at,
  COALESCE(
    (
      SELECT COALESCE(SUM(te.total_tokens), 0)
      FROM agent_turn_ended te
      WHERE te.request_id = a.request_id
    ),
    (
      SELECT COALESCE(SUM(te.input_tokens), 0) + COALESCE(SUM(te.output_tokens), 0) +
             COALESCE(SUM(te.cache_read_tokens), 0) + COALESCE(SUM(te.cache_write_tokens), 0)
      FROM agent_turn_ended te
      WHERE te.request_id = a.request_id
    ),
    (
      SELECT COALESCE(
        NULLIF((
          SELECT COALESCE(SUM(t.streaming_tokens), 0)
          FROM agent_tokens t
          WHERE t.request_id = a.request_id
            AND t.token_type = 'delta'
            AND t.minute_bucket IS NOT NULL
        ), 0),
        (
          SELECT COALESCE(MAX(t.streaming_tokens), 0)
          FROM agent_tokens t
          WHERE t.request_id = a.request_id
            AND t.token_type = 'delta'
            AND t.minute_bucket IS NULL
        )
      )
    ),
    0
  ) AS total_tokens
FROM agents a
WHERE a.conversation_id = '${cid}'
GROUP BY a.request_id
ORDER BY a.started_at;
`);

    return buildAgentTree(rows);
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

  async deleteOldConversations(
    profileId: string,
    beforeTimestamp: number
  ): Promise<number> {
    const pid = escapeSqlString(profileId);
    const countRows = this.executor.queryRows<{ count: number }>(`
SELECT COUNT(*) AS count FROM conversations
WHERE profile_id = '${pid}' AND last_activity < ${beforeTimestamp};
`);
    const count = countRows[0]?.count ?? 0;
    if (count === 0) {
      return 0;
    }

    await this.executor.runStatement(`
DELETE FROM agent_turn_ended
WHERE request_id IN (
  SELECT request_id FROM agents
  WHERE conversation_id IN (
    SELECT conversation_id FROM conversations
    WHERE profile_id = '${pid}' AND last_activity < ${beforeTimestamp}
  )
);
`);
    await this.executor.runStatement(`
DELETE FROM agent_tokens
WHERE request_id IN (
  SELECT request_id FROM agents
  WHERE conversation_id IN (
    SELECT conversation_id FROM conversations
    WHERE profile_id = '${pid}' AND last_activity < ${beforeTimestamp}
  )
);
`);
    await this.executor.runStatement(`
DELETE FROM agents
WHERE conversation_id IN (
  SELECT conversation_id FROM conversations
  WHERE profile_id = '${pid}' AND last_activity < ${beforeTimestamp}
);
`);
    await this.executor.runStatement(`
DELETE FROM conversations
WHERE profile_id = '${pid}' AND last_activity < ${beforeTimestamp};
`);

    return count;
  }

  getDbPath(): string {
    return this.dbPath;
  }
}
