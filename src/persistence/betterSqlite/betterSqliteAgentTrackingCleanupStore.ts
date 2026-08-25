import type { IDatabaseConnectionManager } from '../../domain/ports/IDatabaseConnectionManager';

/**
 * SQLite retention operations for agent tracking.
 *
 * This adapter owns conversation selection and the multi-table cleanup
 * transaction. Schema initialization, read projections, and ordinary writes
 * remain outside this boundary.
 */
export class BetterSqliteAgentTrackingCleanupStore {
  constructor(
    private readonly connectionManager: IDatabaseConnectionManager,
    private readonly dbPath: string
  ) {}

  async deleteOldConversations(
    profileId: string,
    beforeTimestamp: number
  ): Promise<number> {
    const conn = await this.connectionManager.getConnection(this.dbPath);

    return conn.transaction(() => {
      const conversations = conn.all<{ conversation_id: string }>(
        'SELECT conversation_id FROM conversations WHERE profile_id = ? AND created_at < ?',
        profileId,
        beforeTimestamp
      );

      if (conversations.length === 0) {
        return 0;
      }

      const conversationIds = conversations.map(
        (conversation) => conversation.conversation_id
      );
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
