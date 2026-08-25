import type { IAgentTrackingRepository } from '../../domain/ports/IAgentTrackingRepository';
import type { IDatabaseConnectionManager } from '../../domain/ports/IDatabaseConnectionManager';
import { BetterSqliteAgentTrackingReadStore } from './betterSqliteAgentTrackingReadStore';
import { BetterSqliteAgentTrackingSchemaInitializer } from './betterSqliteAgentTrackingSchemaInitializer';
import { BetterSqliteAgentTrackingWriteStore } from './betterSqliteAgentTrackingWriteStore';

/**
 * Agent tracking domain-port facade for the better-sqlite3 adapters.
 *
 * Read models and writes are delegated to focused infrastructure stores. This
 * facade retains migration verification and retention cleanup for compatibility
 * with the existing IAgentTrackingRepository composition boundary.
 */
export class BetterSqliteAgentTrackingRepository implements IAgentTrackingRepository {
  private readonly readStore: BetterSqliteAgentTrackingReadStore;
  private readonly schemaInitializer: BetterSqliteAgentTrackingSchemaInitializer;
  private readonly writeStore: BetterSqliteAgentTrackingWriteStore;

  constructor(
    private readonly connectionManager: IDatabaseConnectionManager,
    private readonly dbPath: string,
    extensionPath: string
  ) {
    this.readStore = new BetterSqliteAgentTrackingReadStore(
      connectionManager,
      dbPath
    );
    this.schemaInitializer = new BetterSqliteAgentTrackingSchemaInitializer(
      connectionManager,
      dbPath,
      extensionPath
    );
    this.writeStore = new BetterSqliteAgentTrackingWriteStore(
      connectionManager,
      dbPath
    );
  }

  async initialize(): Promise<void> {
    return this.schemaInitializer.initialize();
  }

  upsertConversation(
    conversationId: string,
    profileId: string,
    timestamp: number,
    messageCount?: number
  ) {
    return this.writeStore.upsertConversation(
      conversationId,
      profileId,
      timestamp,
      messageCount
    );
  }

  upsertAgent(agent: Parameters<IAgentTrackingRepository['upsertAgent']>[0]) {
    return this.writeStore.upsertAgent(agent);
  }

  insertTokenSnapshot(
    tokens: Parameters<IAgentTrackingRepository['insertTokenSnapshot']>[0]
  ) {
    return this.writeStore.insertTokenSnapshot(tokens);
  }

  upsertTokenDelta(
    delta: Parameters<IAgentTrackingRepository['upsertTokenDelta']>[0]
  ) {
    return this.writeStore.upsertTokenDelta(delta);
  }

  insertTurnEnded(
    turnEnded: Parameters<IAgentTrackingRepository['insertTurnEnded']>[0]
  ) {
    return this.writeStore.insertTurnEnded(turnEnded);
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
