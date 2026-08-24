import type {
  AgentTokenBreakdown,
  IAgentTrackingRepository,
} from '../../domain/ports/IAgentTrackingRepository';
import type { IDatabaseConnectionManager } from '../../domain/ports/IDatabaseConnectionManager';
import * as extensionLog from '../../logging/extensionLog';
import { DatabaseMigrator } from '../databaseMigrations';
import type {
  AgentRecord,
  AgentTreeNode,
  ConversationDeltaTotals,
  ConversationTokenTotals,
  TokenDeltaMinuteRecord,
  TokenSnapshotRecord,
  TurnEndedRecord,
} from '../types';

/**
 * Agent tracking repository using better-sqlite3.
 * 
 * @remarks
 * This repository implements IAgentTrackingRepository using persistent
 * connections from IDatabaseConnectionManager. All SQL queries use
 * parameterized statements to prevent SQL injection.
 * 
 * Prepared statements are cached for frequently-used operations (upserts,
 * inserts) to improve performance.
 */
export class BetterSqliteAgentTrackingRepository implements IAgentTrackingRepository {
  constructor(
    private readonly connectionManager: IDatabaseConnectionManager,
    private readonly dbPath: string,
    private readonly extensionPath: string
  ) {}

  /**
   * Initialize database: run migrations and verify schema.
   */
  async initialize(): Promise<void> {
    extensionLog.info(`[BetterSqliteAgentTracking] Initializing: ${this.dbPath}`);
    
    const conn = await this.connectionManager.getConnection(this.dbPath);
    
    // Run migrations using legacy migrator (temporary during migration phase)
    const migrator = new DatabaseMigrator(this.dbPath, this.extensionPath);
    await migrator.migrate();
    
    // Verify critical tables exist
    const tables = conn.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'"
    );
    const tableNames = tables.map((t) => t.name);
    
    const requiredTables = [
      'conversations',
      'agents',
      'agent_tokens',
      'agent_tokens_delta',
      'agent_tokens_delta_events',
      'agent_turn_ended',
    ];
    
    for (const table of requiredTables) {
      if (!tableNames.includes(table)) {
        throw new Error(`Missing required table: ${table}`);
      }
    }
    
    extensionLog.info('[BetterSqliteAgentTracking] Initialization complete');
  }

  async upsertConversation(
    conversationId: string,
    profileId: string,
    timestamp: number,
    messageCount?: number
  ): Promise<void> {
    const conn = await this.connectionManager.getConnection(this.dbPath);
    
    conn.run(
      `
      INSERT INTO conversations (conversation_id, profile_id, created_at, last_activity, message_count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (conversation_id) DO UPDATE SET
        last_activity = ?,
        message_count = COALESCE(excluded.message_count, conversations.message_count),
        profile_id = excluded.profile_id
      `,
      conversationId,
      profileId,
      timestamp,
      timestamp,
      messageCount ?? null,
      timestamp
    );
  }

  async upsertAgent(agent: AgentRecord): Promise<void> {
    const conn = await this.connectionManager.getConnection(this.dbPath);
    
    conn.run(
      `
      INSERT INTO agents (
        request_id,
        conversation_id,
        conversation_group_id,
        parent_request_id,
        subagent_request_id,
        model_name,
        started_at,
        ended_at,
        is_eof,
        profile_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (request_id) DO UPDATE SET
        conversation_id = excluded.conversation_id,
        conversation_group_id = excluded.conversation_group_id,
        parent_request_id = excluded.parent_request_id,
        subagent_request_id = excluded.subagent_request_id,
        model_name = excluded.model_name,
        ended_at = excluded.ended_at,
        is_eof = excluded.is_eof,
        profile_id = excluded.profile_id
      `,
      agent.requestId,
      agent.conversationId,
      agent.conversationGroupId ?? null,
      agent.parentRequestId ?? null,
      agent.subagentRequestId ?? null,
      agent.modelName ?? null,
      agent.startedAt,
      agent.endedAt ?? null,
      agent.isEof ? 1 : 0,
      agent.profileId
    );
  }

  async insertTokenSnapshot(tokens: Omit<TokenSnapshotRecord, 'id'>): Promise<void> {
    const conn = await this.connectionManager.getConnection(this.dbPath);

    conn.run(
      `
      INSERT OR IGNORE INTO agent_tokens (
        request_id,
        token_type,
        streaming_tokens,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        total_tokens,
        usage_uuid,
        recorded_at,
        model_name,
        turn_index,
        http_request_id,
        minute_bucket,
        event_key
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      tokens.requestId,
      tokens.tokenType,
      tokens.streamingTokens ?? null,
      tokens.inputTokens ?? null,
      tokens.outputTokens ?? null,
      tokens.cacheReadTokens ?? null,
      tokens.cacheWriteTokens ?? null,
      tokens.totalTokens ?? null,
      tokens.usageUuid ?? null,
      tokens.recordedAt,
      tokens.modelName ?? null,
      tokens.turnIndex ?? null,
      tokens.httpRequestId ?? null,
      tokens.minuteBucket ?? null,
      tokens.eventKey ?? null
    );
  }

  async upsertTokenDelta(delta: TokenDeltaMinuteRecord): Promise<void> {
    const conn = await this.connectionManager.getConnection(this.dbPath);
    
    // Look up conversation_id from agents table
    const agent = conn.get<{ conversation_id: string }>(
      'SELECT conversation_id FROM agents WHERE request_id = ?',
      delta.requestId
    );
    
    if (!agent) {
      extensionLog.warn(
        `[BetterSqliteAgentTracking] Cannot upsert delta for unknown agent: ${delta.requestId}`
      );
      return;
    }
    
    const writeAggregate = (): void => {
      conn.run(
        `
        INSERT INTO agent_tokens_delta (
          request_id,
          conversation_id,
          minute_bucket,
          delta_tokens,
          delta_cost,
          context_used,
          context_max
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (request_id, minute_bucket) DO UPDATE SET
          delta_tokens = agent_tokens_delta.delta_tokens + excluded.delta_tokens,
          delta_cost = agent_tokens_delta.delta_cost + excluded.delta_cost,
          context_used = COALESCE(excluded.context_used, agent_tokens_delta.context_used),
          context_max = COALESCE(excluded.context_max, agent_tokens_delta.context_max)
        `,
        delta.requestId,
        agent.conversation_id,
        delta.minuteBucket,
        delta.streamingTokens,
        delta.costCents ?? 0,
        delta.contextUsedTokens ?? null,
        delta.contextMaxTokens ?? null
      );
    };

    if (!delta.eventKey) {
      writeAggregate();
      return;
    }

    conn.transaction(() => {
      // INSERT OR IGNORE is the atomic idempotency gate. The connection-local
      // changes() result is read immediately, before another statement runs.
      conn.run(
        `
        INSERT OR IGNORE INTO agent_tokens_delta_events (
          event_key,
          request_id,
          conversation_id,
          minute_bucket,
          delta_tokens,
          delta_cost,
          context_used,
          context_max,
          recorded_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        delta.eventKey,
        delta.requestId,
        agent.conversation_id,
        delta.minuteBucket,
        delta.streamingTokens,
        delta.costCents ?? 0,
        delta.contextUsedTokens ?? null,
        delta.contextMaxTokens ?? null,
        delta.recordedAt ?? null
      );
      const changes = conn.get<{ changes: number }>('SELECT changes() AS changes');
      if (changes?.changes !== 1) {
        return;
      }
      writeAggregate();
    });
  }

  async insertTurnEnded(turnEnded: Omit<TurnEndedRecord, 'id'>): Promise<void> {
    const conn = await this.connectionManager.getConnection(this.dbPath);
    
    conn.run(
      `
      INSERT OR IGNORE INTO agent_turn_ended (
        request_id,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        total_tokens,
        total_cents,
        usage_uuid,
        recorded_at,
        model_name,
        http_request_id,
        event_key
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      turnEnded.requestId,
      turnEnded.inputTokens,
      turnEnded.outputTokens,
      turnEnded.cacheReadTokens ?? null,
      turnEnded.cacheWriteTokens ?? null,
      turnEnded.totalTokens ?? null,
      turnEnded.totalCents ?? null,
      turnEnded.usageUuid ?? null,
      turnEnded.recordedAt,
      turnEnded.modelName ?? null,
      turnEnded.httpRequestId ?? null,
      turnEnded.eventKey ?? null
    );
  }

  async getTotalConversationTokens(conversationId: string): Promise<ConversationTokenTotals> {
    const conn = await this.connectionManager.getConnection(this.dbPath);
    
    const row = conn.get<{
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
    }>(`
      WITH snapshot_agg AS (
        SELECT
          COALESCE(SUM(te.input_tokens), 0) AS total_input,
          COALESCE(SUM(te.output_tokens), 0) AS total_output,
          COALESCE(SUM(te.cache_read_tokens), 0) AS total_cache_read,
          COALESCE(SUM(te.cache_write_tokens), 0) AS total_cache_write,
          COALESCE(SUM(te.total_tokens), 0) AS total
        FROM agent_turn_ended te
        INNER JOIN agents a ON a.request_id = te.request_id
        WHERE a.conversation_id = ?
      ),
      delta_agg AS (
        SELECT
          COALESCE(SUM(delta_tokens), 0) AS total_delta,
          COALESCE(SUM(delta_cost), 0) AS total_delta_cost,
          MAX(context_used) AS latest_context_used,
          MAX(context_max) AS latest_context_max,
          COUNT(*) AS delta_buckets
        FROM agent_tokens_delta
        WHERE conversation_id = ?
      ),
      turn_agg AS (
        SELECT COALESCE(SUM(total_cents), 0) AS total_turn_cost
        FROM agent_turn_ended te
        INNER JOIN agents a ON a.request_id = te.request_id
        WHERE a.conversation_id = ?
      ),
      agent_agg AS (
        SELECT
          COUNT(*) AS agent_count,
          MIN(started_at) AS started_at,
          MAX(ended_at) AS ended_at,
          GROUP_CONCAT(DISTINCT model_name) AS models
        FROM agents
        WHERE conversation_id = ? AND model_name IS NOT NULL
      )
      SELECT
        s.total_input,
        s.total_output,
        s.total_cache_read,
        s.total_cache_write,
        s.total,
        d.total_delta,
        d.total_delta_cost,
        t.total_turn_cost,
        d.latest_context_used,
        d.latest_context_max,
        d.delta_buckets,
        a.agent_count,
        a.started_at,
        a.ended_at,
        a.models
      FROM snapshot_agg s, delta_agg d, turn_agg t, agent_agg a
    `, conversationId, conversationId, conversationId, conversationId);
    
    if (!row) {
      return this.emptyConversationTokenTotals();
    }
    
    return {
      totalInputTokens: row.total_input,
      totalOutputTokens: row.total_output,
      totalCacheReadTokens: row.total_cache_read,
      totalCacheWriteTokens: row.total_cache_write,
      totalTokens: row.total,
      totalDeltaTokens: row.total_delta,
      totalDeltaCostCents: row.total_delta_cost,
      totalTurnCostCents: row.total_turn_cost,
      latestContextUsedTokens: row.latest_context_used ?? undefined,
      latestContextMaxTokens: row.latest_context_max ?? undefined,
      deltaMinuteBuckets: row.delta_buckets,
      agentCount: row.agent_count,
      startedAt: row.started_at ?? 0,
      endedAt: row.ended_at ?? 0,
      models: row.models ? row.models.split(',') : [],
    };
  }

  async getTotalDeltaTokensByConversation(
    conversationId: string
  ): Promise<ConversationDeltaTotals> {
    const conn = await this.connectionManager.getConnection(this.dbPath);
    
    const row = conn.get<{
      total_delta: number;
      total_cost: number;
      delta_buckets: number;
    }>(`
      SELECT
        COALESCE(SUM(delta_tokens), 0) AS total_delta,
        COALESCE(SUM(delta_cost), 0) AS total_cost,
        COUNT(*) AS delta_buckets
      FROM agent_tokens_delta
      WHERE conversation_id = ?
    `, conversationId);
    
    if (!row) {
      return { totalStreamingTokens: 0, totalCostCents: 0, minuteBuckets: 0 };
    }
    
    return {
      totalStreamingTokens: row.total_delta,
      totalCostCents: row.total_cost,
      minuteBuckets: row.delta_buckets,
    };
  }

  async getTurnEndedByConversation(conversationId: string): Promise<TurnEndedRecord[]> {
    const conn = await this.connectionManager.getConnection(this.dbPath);
    
    const rows = conn.all<{
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
      event_key: string | null;
    }>(`
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
        ,te.event_key
      FROM agent_turn_ended te
      INNER JOIN agents a ON a.request_id = te.request_id
      WHERE a.conversation_id = ?
      ORDER BY te.recorded_at DESC
    `, conversationId);
    
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
      eventKey: row.event_key ?? undefined,
    }));
  }

  async getAgentTokens(requestId: string): Promise<AgentTokenBreakdown | null> {
    const conn = await this.connectionManager.getConnection(this.dbPath);
    
    const row = conn.get<{
      request_id: string;
      conversation_id: string;
      parent_request_id: string | null;
      model_name: string | null;
      started_at: number;
      ended_at: number | null;
      peak_streaming: number | null;
      final_input: number | null;
      final_output: number | null;
      final_cache_read: number | null;
      final_cache_write: number | null;
      final_total: number | null;
    }>(`
      SELECT
        a.request_id,
        a.conversation_id,
        a.parent_request_id,
        a.model_name,
        a.started_at,
        a.ended_at,
        MAX(t.streaming_tokens) AS peak_streaming,
        MAX(t.input_tokens) AS final_input,
        MAX(t.output_tokens) AS final_output,
        MAX(t.cache_read_tokens) AS final_cache_read,
        MAX(t.cache_write_tokens) AS final_cache_write,
        MAX(t.total_tokens) AS final_total
      FROM agents a
      LEFT JOIN agent_tokens t ON t.request_id = a.request_id
      WHERE a.request_id = ?
      GROUP BY a.request_id
    `, requestId);
    
    if (!row) {
      return null;
    }
    
    return {
      requestId: row.request_id,
      conversationId: row.conversation_id,
      parentRequestId: row.parent_request_id ?? undefined,
      modelName: row.model_name ?? undefined,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      peakStreamingTokens: row.peak_streaming ?? 0,
      finalInputTokens: row.final_input ?? 0,
      finalOutputTokens: row.final_output ?? 0,
      finalCacheReadTokens: row.final_cache_read ?? 0,
      finalCacheWriteTokens: row.final_cache_write ?? 0,
      finalTotalTokens: row.final_total ?? 0,
    };
  }

  async getAgentTree(conversationId: string): Promise<AgentTreeNode[]> {
    const conn = await this.connectionManager.getConnection(this.dbPath);
    
    const rows = conn.all<{
      request_id: string;
      parent_request_id: string | null;
      model_name: string | null;
      started_at: number;
      ended_at: number | null;
      total_tokens: number;
    }>(`
      SELECT
        a.request_id,
        a.parent_request_id,
        a.model_name,
        a.started_at,
        a.ended_at,
        COALESCE(MAX(t.total_tokens), 0) AS total_tokens
      FROM agents a
      LEFT JOIN agent_tokens t ON t.request_id = a.request_id
      WHERE a.conversation_id = ?
      GROUP BY a.request_id
      ORDER BY a.started_at ASC
    `, conversationId);
    
    return this.buildAgentTree(rows);
  }

  async getDatabaseSize(): Promise<number> {
    const conn = await this.connectionManager.getConnection(this.dbPath);
    
    // Get both values separately since SQLite pragma doesn't work well with compound queries
    const pageCount = conn.get<{ page_count: number }>('PRAGMA page_count')?.page_count ?? 0;
    const pageSize = conn.get<{ page_size: number }>('PRAGMA page_size')?.page_size ?? 0;
    
    return +pageCount * +pageSize;
  }

  async deleteOldConversations(
    profileId: string,
    beforeTimestamp: number
  ): Promise<number> {
    const conn = await this.connectionManager.getConnection(this.dbPath);
    
    // Use transaction for multi-table cascade delete
    return conn.transaction(() => {
      // Find conversations to delete
      const conversations = conn.all<{ conversation_id: string }>(
        'SELECT conversation_id FROM conversations WHERE profile_id = ? AND started_at < ?',
        profileId,
        beforeTimestamp
      );
      
      if (conversations.length === 0) {
        return 0;
      }
      
      const conversationIds = conversations.map((c) => c.conversation_id);
      const placeholders = conversationIds.map(() => '?').join(',');
      
      // Delete snapshots by request_id because agent_tokens has no
      // conversation_id column.
      conn.run(
        `DELETE FROM agent_tokens WHERE request_id IN (
          SELECT request_id FROM agents WHERE conversation_id IN (${placeholders})
        )`,
        ...conversationIds
      );
      
      conn.run(
        `DELETE FROM agent_tokens_delta WHERE conversation_id IN (${placeholders})`,
        ...conversationIds
      );

      conn.run(
        `DELETE FROM agent_tokens_delta_events WHERE conversation_id IN (${placeholders})`,
        ...conversationIds
      );
      
      // Delete turn_ended rows (via agent cascade)
      conn.run(
        `DELETE FROM agent_turn_ended WHERE request_id IN (
          SELECT request_id FROM agents WHERE conversation_id IN (${placeholders})
        )`,
        ...conversationIds
      );
      
      // Delete agents
      conn.run(
        `DELETE FROM agents WHERE conversation_id IN (${placeholders})`,
        ...conversationIds
      );
      
      // Delete conversations
      conn.run(
        `DELETE FROM conversations WHERE conversation_id IN (${placeholders})`,
        ...conversationIds
      );
      
      return conversations.length;
    });
  }

  // Helper methods

  private emptyConversationTokenTotals(): ConversationTokenTotals {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalTokens: 0,
      totalDeltaTokens: 0,
      totalDeltaCostCents: 0,
      totalTurnCostCents: 0,
      deltaMinuteBuckets: 0,
      agentCount: 0,
      models: [],
      startedAt: 0,
      endedAt: 0,
    };
  }

  private buildAgentTree(
    rows: Array<{
      request_id: string;
      parent_request_id: string | null;
      model_name: string | null;
      started_at: number;
      ended_at: number | null;
      total_tokens: number;
    }>
  ): AgentTreeNode[] {
    const nodes = new Map<string, AgentTreeNode>();
    
    // Create nodes
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
    
    // Build tree structure
    const roots: AgentTreeNode[] = [];
    for (const node of nodes.values()) {
      if (node.parentRequestId) {
        const parent = nodes.get(node.parentRequestId);
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    }
    
    return roots;
  }
}
