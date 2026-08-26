import type { CostSource } from '../../domain/types/costProvenance';
import { mergeAgentSessionFields } from '../../domain/services/agentSessionInfo';
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

function createLiveTokenUpdate(
  relationshipIds: Partial<AgentSessionInfo>,
  accumulatedTokens: number,
  latestDelta: number,
  eventSequence: number
): LiveTokenUpdate {
  return {
    accumulatedTokens,
    latestDelta,
    agent: mergeAgentSessionFields(relationshipIds, {
      streamingTokens: accumulatedTokens,
      usageEvent: 'token_delta',
      eventSequence,
    }),
  };
}

function createTurnEndedEvent(
  relationshipIds: Partial<AgentSessionInfo>,
  insight: AgentSessionInfo,
  eventSequence: number
): TurnEndedEvent {
  return {
    inputTokens: insight.inputTokens ?? 0,
    outputTokens: insight.outputTokens ?? 0,
    cacheReadTokens: insight.cacheReadTokens,
    cacheWriteTokens: insight.cacheWriteTokens,
    totalCents: insight.totalCents,
    agent: mergeAgentSessionFields(relationshipIds, {
      inputTokens: insight.inputTokens,
      outputTokens: insight.outputTokens,
      cacheReadTokens: insight.cacheReadTokens,
      cacheWriteTokens: insight.cacheWriteTokens,
      totalCents: insight.totalCents,
      usageEvent: 'turn_ended',
      eventSequence,
    }),
  };
}

function createTokenDetailsUpdate(
  relationshipIds: Partial<AgentSessionInfo>,
  accumulatedTokens: number,
  insight: AgentSessionInfo,
  eventSequence: number
): LiveTokenUpdate {
  return {
    accumulatedTokens,
    latestDelta: 0,
    agent: mergeAgentSessionFields(relationshipIds, {
      ...insight,
      eventSequence,
    }),
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
  const relationshipIds = mergeAgentSessionFields(
    state.relationshipIds,
    input.relationshipIds
  );
  const messageCount = state.messageCount + 1;
  const nextState: StreamingAgentPolicyState = {
    messageCount,
    accumulatedTokens: state.accumulatedTokens,
    relationshipIds,
  };

  if (!input.insight) {
    return { state: nextState };
  }

  switch (input.insight.usageEvent) {
    case 'token_delta': {
      const latestDelta = input.insight.streamingTokens;
      if (latestDelta == null) {
        return { state: nextState };
      }
      const accumulatedTokens = state.accumulatedTokens + latestDelta;
      return {
        state: { ...nextState, accumulatedTokens },
        liveUpdate: createLiveTokenUpdate(
          relationshipIds,
          accumulatedTokens,
          latestDelta,
          messageCount
        ),
      };
    }
    case 'turn_ended':
      return {
        state: { ...nextState, accumulatedTokens: 0 },
        turnEndedEvent: createTurnEndedEvent(
          relationshipIds,
          input.insight,
          messageCount
        ),
      };
    case 'token_details':
      return {
        state: nextState,
        liveUpdate: createTokenDetailsUpdate(
          relationshipIds,
          state.accumulatedTokens,
          input.insight,
          messageCount
        ),
      };
    default:
      return { state: nextState };
  }
}
