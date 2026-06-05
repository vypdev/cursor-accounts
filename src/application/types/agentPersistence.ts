/** Persistence records for agent tracking (domain contract shapes). */

export interface ConversationRecord {
  conversationId: string;
  profileId: string;
  createdAt: number;
  lastActivity: number;
  messageCount?: number;
}

export interface AgentRecord {
  requestId: string;
  conversationId: string;
  conversationGroupId?: string;
  parentRequestId?: string;
  subagentRequestId?: string;
  modelName?: string;
  startedAt: number;
  endedAt?: number;
  isEof: boolean;
  profileId: string;
}

export type AgentTokenType = 'delta' | 'turn_ended' | 'token_details';

export interface TokenSnapshotRecord {
  id?: number;
  requestId: string;
  tokenType: AgentTokenType;
  streamingTokens?: number;
  outputTokens?: number;
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  usageUuid?: string;
  recordedAt: number;
  modelName?: string;
  turnIndex?: number;
  httpRequestId?: string;
}

export interface AgentTreeNode {
  requestId: string;
  parentRequestId?: string;
  modelName?: string;
  startedAt: number;
  endedAt?: number;
  totalTokens: number;
  children: AgentTreeNode[];
}

export interface ConversationTokenTotals {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalTokens: number;
  agentCount: number;
  models: string[];
  startedAt: number;
  endedAt: number;
}
