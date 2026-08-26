import type { CostSource } from '../../domain/types/costProvenance';
import { mergeAgentSessionInfo } from '../../domain/services/agentSessionInfo';
import type { AgentSessionInfo } from '../types/agentTracking';

export interface StreamingAgentPolicyState {
  messageCount: number;
  accumulatedTokens: number;
  relationshipIds: Partial<AgentSessionInfo>;
}

/** Live progress counter update (CLI-style sum of token_delta). */
export interface LiveTokenUpdate {
  accumulatedTokens: number;
  latestDelta: number;
  modelId?: string;
  deltaCostCents?: number;
  costSource?: Exclude<CostSource, 'mixed' | 'unknown'>;
  pricingSnapshotVersion?: string;
  agent: AgentSessionInfo;
}

/** Billing-grade turn completion from server turn_ended. */
export interface TurnEndedEvent {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalCents?: number;
  modelId?: string;
  calculatedCostCents?: number;
  calculatedCostSource?: Exclude<CostSource, 'mixed' | 'unknown'>;
  pricingSnapshotVersion?: string;
  agent: AgentSessionInfo;
}

export interface StreamingAgentPolicyInput {
  relationshipIds: Partial<AgentSessionInfo>;
  insight: AgentSessionInfo | null;
}

export interface StreamingAgentPolicyResult {
  state: StreamingAgentPolicyState;
  liveUpdate?: LiveTokenUpdate;
  turnEndedEvent?: TurnEndedEvent;
}

export function createStreamingAgentPolicyState(): StreamingAgentPolicyState {
  return {
    messageCount: 0,
    accumulatedTokens: 0,
    relationshipIds: {},
  };
}

/**
 * Apply one decoded AgentServerMessage to the live stream state.
 *
 * The policy is deliberately transport-free: framing and protobuf extraction
 * stay in the proxy adapter while this function owns event sequencing,
 * relationship merging, and token/turn state transitions.
 */
export function applyStreamingAgentMessage(
  state: StreamingAgentPolicyState,
  input: StreamingAgentPolicyInput
): StreamingAgentPolicyResult {
  const relationshipIds =
    mergeAgentSessionInfo(state.relationshipIds, input.relationshipIds) ??
    state.relationshipIds;
  const messageCount = state.messageCount + 1;
  const nextState: StreamingAgentPolicyState = {
    messageCount,
    accumulatedTokens: state.accumulatedTokens,
    relationshipIds,
  };

  if (!input.insight) {
    return { state: nextState };
  }

  if (
    input.insight.usageEvent === 'token_delta' &&
    input.insight.streamingTokens != null
  ) {
    const latestDelta = input.insight.streamingTokens;
    const accumulatedTokens = state.accumulatedTokens + latestDelta;
    return {
      state: { ...nextState, accumulatedTokens },
      liveUpdate: {
        accumulatedTokens,
        latestDelta,
        agent:
          mergeAgentSessionInfo(relationshipIds, {
            streamingTokens: accumulatedTokens,
            usageEvent: 'token_delta',
            eventSequence: messageCount,
          }) ?? {
            streamingTokens: accumulatedTokens,
            usageEvent: 'token_delta',
            eventSequence: messageCount,
          },
      },
    };
  }

  if (input.insight.usageEvent === 'turn_ended') {
    return {
      state: { ...nextState, accumulatedTokens: 0 },
      turnEndedEvent: {
        inputTokens: input.insight.inputTokens ?? 0,
        outputTokens: input.insight.outputTokens ?? 0,
        cacheReadTokens: input.insight.cacheReadTokens,
        cacheWriteTokens: input.insight.cacheWriteTokens,
        totalCents: input.insight.totalCents,
        agent:
          mergeAgentSessionInfo(relationshipIds, {
            inputTokens: input.insight.inputTokens,
            outputTokens: input.insight.outputTokens,
            cacheReadTokens: input.insight.cacheReadTokens,
            cacheWriteTokens: input.insight.cacheWriteTokens,
            totalCents: input.insight.totalCents,
            usageEvent: 'turn_ended',
            eventSequence: messageCount,
          }) ?? {
            usageEvent: 'turn_ended',
            eventSequence: messageCount,
          },
      },
    };
  }

  if (input.insight.usageEvent === 'token_details') {
    return {
      state: nextState,
      liveUpdate: {
        accumulatedTokens: state.accumulatedTokens,
        latestDelta: 0,
        agent:
          mergeAgentSessionInfo(relationshipIds, {
            ...input.insight,
            eventSequence: messageCount,
          }) ?? {
            ...input.insight,
            eventSequence: messageCount,
          },
      },
    };
  }

  return { state: nextState };
}
