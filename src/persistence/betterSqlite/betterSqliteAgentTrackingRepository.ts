import type {
  IAgentTrackingRepository,
} from '../../domain/ports/IAgentTrackingRepository';
import type { IDatabaseConnectionManager } from '../../domain/ports/IDatabaseConnectionManager';
import * as extensionLog from '../../logging/extensionLog';
import { DatabaseMigrator } from '../databaseMigrations';
import type {
  AgentRecord,
  TokenDeltaMinuteRecord,
  TokenSnapshotRecord,
  TurnEndedRecord,
} from '../types';
import { BetterSqliteAgentTrackingReadStore } from './betterSqliteAgentTrackingReadStore';

/**
 * Agent tracking write and lifecycle adapter using better-sqlite3.
 *
 * Read models are delegated to BetterSqliteAgentTrackingReadStore. This
 * repository owns migrations, writes, idempotency transactions, and cleanup.
 */
export class BetterSqliteAgentTrackingRepository implements IAgentTrackingRepository {
  private readonly readStore: BetterSqliteAgentTrackingReadStore;

  constructor(
    private readonly connectionManager: IDatabaseConnectionManager,
    private readonly dbPath: string,
    private readonly extensionPath: string
  ) {
    this.readStore = new BetterSqliteAgentTrackingReadStore(
      connectionManager,
      dbPath
    );
  }

  async initialize(): Promise<void> {
    extensionLog.info(`[BetterSqliteAgentTracking] Initializing: ${this.dbPath}`);

    const conn = await this.connectionManager.getConnection(this.dbPath);
    const migrator = new DatabaseMigrator(this.dbPath, this.extensionPath);
    await migrator.migrate();

    const tables = conn.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'"
    );
    const tableNames = tables.map((table) => table.name);
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

  async insertTokenSnapshot(
    tokens: Omit<TokenSnapshotRecord, 'id'>
  ): Promise<void> {
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

  getTotalConversationTokens(conversationId: string) {
    return this.readStore.getTotalConversationTokens(conversationId);
  }

  getTotalDeltaTokensByConversation(conversationId: string) {
    return this.readStore.getTotalDeltaTokensByConversation(conversationId);
  }

  getTurnEndedByConversation(conversationId: string) {
    return this.readStore.getTurnEndedByConversation(conversationId);
  }

  getAgentTokens(requestId: string) {
    return this.readStore.getAgentTokens(requestId);
  }

  getAgentTree(conversationId: string) {
    return this.readStore.getAgentTree(conversationId);
  }

  getDatabaseSize() {
    return this.readStore.getDatabaseSize();
  }

  async deleteOldConversations(
    profileId: string,
    beforeTimestamp: number
  ): Promise<number> {
    const conn = await this.connectionManager.getConnection(this.dbPath);

    return conn.transaction(() => {
      const conversations = conn.all<{ conversation_id: string }>(
        'SELECT conversation_id FROM conversations WHERE profile_id = ? AND started_at < ?',
        profileId,
        beforeTimestamp
      );

      if (conversations.length === 0) {
        return 0;
      }

      const conversationIds = conversations.map((conversation) => conversation.conversation_id);
      const placeholders = conversationIds.map(() => '?').join(',');

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
      conn.run(
        `DELETE FROM agent_turn_ended WHERE request_id IN (
          SELECT request_id FROM agents WHERE conversation_id IN (${placeholders})
        )`,
        ...conversationIds
      );
      conn.run(
        `DELETE FROM agents WHERE conversation_id IN (${placeholders})`,
        ...conversationIds
      );
      conn.run(
        `DELETE FROM conversations WHERE conversation_id IN (${placeholders})`,
        ...conversationIds
      );

      return conversations.length;
    });
  }
}
