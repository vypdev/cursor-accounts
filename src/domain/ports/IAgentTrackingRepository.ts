import type {
  AgentRecord,
  AgentTreeNode,
  ConversationTokenTotals,
  TokenSnapshotRecord,
} from '../../application/types/agentPersistence';

/**
 * Repository interface for agent tracking persistence.
 * Domain layer defines the contract; infrastructure implements it.
 */
export interface IAgentTrackingRepository {
  initialize(): Promise<void>;

  upsertConversation(
    conversationId: string,
    profileId: string,
    timestamp: number,
    messageCount?: number
  ): Promise<void>;

  upsertAgent(agent: AgentRecord): Promise<void>;

  insertTokenSnapshot(tokens: Omit<TokenSnapshotRecord, 'id'>): Promise<void>;

  getTotalConversationTokens(conversationId: string): Promise<ConversationTokenTotals>;

  getAgentTokens(requestId: string): Promise<AgentTokenBreakdown | null>;

  getAgentTree(conversationId: string): Promise<AgentTreeNode[]>;

  getDatabaseSize(): Promise<number>;

  deleteOldConversations(
    profileId: string,
    beforeTimestamp: number
  ): Promise<number>;
}

export interface AgentTokenBreakdown {
  requestId: string;
  conversationId: string;
  parentRequestId?: string;
  modelName?: string;
  startedAt: number;
  endedAt?: number;
  peakStreamingTokens: number;
  finalInputTokens: number;
  finalOutputTokens: number;
  finalCacheReadTokens: number;
  finalCacheWriteTokens: number;
  finalTotalTokens: number;
}
