/** Bidi/Agent poll session metadata (HTTP/1 api2 path). */
export interface AgentSessionInfo {
  requestId?: string;
  conversationId?: string;
  conversationGroupId?: string;
  parentRequestId?: string;
  subagentRequestId?: string;
  appendSeqno?: number;
  pollSeqno?: number;
  /** Stable position of the decoded event within its HTTP stream. */
  eventSequence?: number;
  eof?: boolean;
  /** Truncated `data` string from BidiAppend / BidiPoll when present. */
  dataPreview?: string;
  /** Length of `data_binary` on BidiAppend when present. */
  dataBytes?: number;
  /** Latest streaming counter from InteractionUpdate.token_delta. */
  streamingTokens?: number;
  /** Context window usage from conversation_checkpoint_update.token_details. */
  contextUsedTokens?: number;
  /** Context window size from conversation_checkpoint_update.token_details. */
  maxTokens?: number;
  /** Final turn usage when InteractionUpdate.turn_ended is present. */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Billing correlation id from stream chunks (StreamChat / unified). */
  usageUuid?: string;
  /** Rough USD estimate from token counts (configurable rate). */
  estimatedCostUsd?: number;
  /** Model name observed on this agent session. */
  modelName?: string;
  /** User-selected model id from Agent runRequest (BidiAppend). */
  requestedModelId?: string;
  /** Display name from runRequest.modelDetails. */
  modelDisplayName?: string;
  /** Subagent type when runRequest launches a subagent. */
  subagentTypeName?: string;
  /** Server-reported model cost in USD cents (turn_ended / TokenUsage). */
  totalCents?: number;
  /** What triggered the latest agent usage fields. */
  usageEvent?: 'token_delta' | 'turn_ended' | 'token_details' | 'usage_uuid';
}
