/** Result of persisting live usage rows that affect conversation totals. */
export interface IngestTrafficResult {
  conversationId: string;
  deltaPersisted: boolean;
  turnEndedPersisted: boolean;
  contextPersisted: boolean;
}

import type { CostSource } from './costProvenance';

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
  /** Stable identity of the source event; used to make replayed traffic idempotent. */
  eventKey?: string;
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
  /** Unix seconds truncated to minute bucket for aggregated delta rows. */
  minuteBucket?: number;
}

/** Aggregated token_delta for one request_id within a one-minute window. */
export interface TokenDeltaMinuteRecord {
  /** Stable identity of the source event; used to prevent aggregate double-counting. */
  eventKey?: string;
  requestId: string;
  minuteBucket: number;
  streamingTokens: number;
  /** Estimated live delta cost in USD cents for this increment. */
  costCents?: number;
  /** Origin of the incremental cost value. */
  costSource?: CostSource;
  /** Pricing snapshot used for a model-aware incremental estimate. */
  pricingSnapshotVersion?: string;
  /** Context window usage at the time of this delta snapshot. */
  contextUsedTokens?: number;
  contextMaxTokens?: number;
  /** Unix seconds of the latest event in this bucket (for ordering). */
  recordedAt?: number;
  modelName?: string;
}

/** Billing-grade turn completion (one row per server turn_ended event). */
export interface TurnEndedRecord {
  id?: number;
  /** Stable identity of the source event; used to make replayed traffic idempotent. */
  eventKey?: string;
  requestId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  totalCents?: number;
  /** Origin of the persisted turn cost. */
  costSource?: CostSource;
  /** Pricing snapshot used for a model-aware turn estimate. */
  pricingSnapshotVersion?: string;
  usageUuid?: string;
  recordedAt: number;
  modelName?: string;
  httpRequestId?: string;
}

export interface ConversationDeltaTotals {
  totalStreamingTokens: number;
  /** Sum of minute-bucketed delta cost in USD cents. */
  totalCostCents: number;
  minuteBuckets: number;
  /** Distinct provenance values contributing to the aggregate. */
  costSources?: readonly CostSource[];
  /** Distinct pricing snapshots contributing to the aggregate. */
  pricingSnapshotVersions?: readonly string[];
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
  /** Sum of minute-bucketed token_delta rows for this conversation. */
  totalDeltaTokens: number;
  /** Sum of minute-bucketed delta cost in USD cents. */
  totalDeltaCostCents: number;
  /** Sum of server/calculated turn_ended cost in USD cents. */
  totalTurnCostCents: number;
  /** Latest context snapshot from the most recent delta row for this conversation. */
  latestContextUsedTokens?: number;
  latestContextMaxTokens?: number;
  /** Distinct minute buckets with delta activity. */
  deltaMinuteBuckets: number;
  /** Distinct provenance values contributing to minute-bucketed costs. */
  deltaCostSources?: readonly CostSource[];
  /** Distinct provenance values contributing to completed-turn costs. */
  turnCostSources?: readonly CostSource[];
  /** Distinct model-pricing snapshots contributing to either cost total. */
  pricingSnapshotVersions?: readonly string[];
  agentCount: number;
  models: string[];
  startedAt: number;
  endedAt: number;
}
