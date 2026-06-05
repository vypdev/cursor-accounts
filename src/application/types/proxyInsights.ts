import type { AgentSessionInfo } from './agentTracking';

export interface TokenUsageInfo {
  modelName?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  /** Server-reported model cost in USD cents. */
  totalCents?: number;
}

export interface BillingInfo {
  billingCycleStart?: string;
  billingCycleEnd?: string;
  planUsage?: {
    slowRequests?: number;
    fastRequests?: number;
    limit?: number;
  };
  spendLimit?: {
    currentSpendUsd?: number;
    limitUsd?: number;
  };
}

export interface ConversationContext {
  conversationId?: string;
  conversationGroupId?: string;
  messageCount?: number;
  totalContextTokens?: number;
  includedFiles?: string[];
}

export interface ProxyInsights {
  billing?: BillingInfo;
  tokens?: TokenUsageInfo;
  context?: ConversationContext;
  agent?: AgentSessionInfo;
  /** Ordered token_delta frames from RunSSE stream scan (for turn detection). */
  allTokenFrames?: AgentSessionInfo[];
  /** Pre-detected turn from incremental RunSSE decode (persist without re-scanning). */
  completedTurn?: {
    streamingTokens: number;
    turnIndex: number;
  };
  /** When true, turn rows were already persisted incrementally during the stream. */
  streamingTurnsAlreadyPersisted?: boolean;
}
