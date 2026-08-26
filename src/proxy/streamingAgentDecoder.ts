import {
  decodeAgentServerPayload,
} from './agentStreamDecode';
import { ConnectFrameAccumulator } from './connectFrameAccumulator';
import type { ProtoRegistry } from './protoRegistry';
import {
  extractAgentInnerInsights,
  extractConversationAndSubagentIds,
  type AgentSessionInfo,
} from './proxyInsightExtractor';
import {
  applyStreamingAgentMessage,
  createStreamingAgentPolicyState,
  type LiveTokenUpdate,
  type TurnEndedEvent,
} from '../application/services/streamingAgentDecoderPolicy';

export interface StreamingDecoderState {
  bufferLength: number;
  messageCount: number;
  accumulatedTokens: number;
  relationshipIds: Partial<AgentSessionInfo>;
}

export type { LiveTokenUpdate, TurnEndedEvent } from
  '../application/services/streamingAgentDecoderPolicy';

export interface FeedChunkResult {
  liveUpdates: LiveTokenUpdate[];
  turnEndedEvents: TurnEndedEvent[];
}

/**
 * Incrementally decodes Connect-framed RunSSE / StreamBidi response chunks.
 * Emits every token_delta for live UI and server turn_ended for persistence.
 */
export class StreamingAgentDecoder {
  private readonly frameAccumulator = new ConnectFrameAccumulator();
  private policyState = createStreamingAgentPolicyState();

  constructor(private readonly registry: ProtoRegistry) {}

  feedChunk(chunk: Buffer): FeedChunkResult {
    if (chunk.length === 0) {
      return { liveUpdates: [], turnEndedEvents: [] };
    }

    const liveUpdates: LiveTokenUpdate[] = [];
    const turnEndedEvents: TurnEndedEvent[] = [];

    for (const payload of this.frameAccumulator.feed(chunk)) {
      const decoded = decodeAgentServerPayload(this.registry, payload);
      if (!decoded) {
        continue;
      }

      const ids = extractConversationAndSubagentIds(decoded);
      const insight = extractAgentInnerInsights(decoded);
      const policyResult = applyStreamingAgentMessage(this.policyState, {
        relationshipIds: ids,
        insight,
      });
      this.policyState = policyResult.state;
      if (policyResult.liveUpdate) {
        liveUpdates.push(policyResult.liveUpdate);
      }
      if (policyResult.turnEndedEvent) {
        turnEndedEvents.push(policyResult.turnEndedEvent);
      }
    }

    return { liveUpdates, turnEndedEvents };
  }

  /**
   * Clears decoder state at stream end.
   * Live totals are already emitted on each token_delta; no duplicate emit here.
   */
  finalize(): LiveTokenUpdate | null {
    this.resetStreamState();
    return null;
  }

  getState(): StreamingDecoderState {
    return {
      bufferLength: this.frameAccumulator.bufferedLength,
      messageCount: this.policyState.messageCount,
      accumulatedTokens: this.policyState.accumulatedTokens,
      relationshipIds: { ...this.policyState.relationshipIds },
    };
  }

  private resetStreamState(): void {
    this.frameAccumulator.reset();
    this.policyState = createStreamingAgentPolicyState();
  }
}
