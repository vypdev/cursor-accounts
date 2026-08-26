import {
  decodeAgentServerPayload,
  tryConnectFrame,
} from './agentStreamDecode';
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

const MAX_CONNECT_FRAME_BYTES = 5_000_000;

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
  private buffer = Buffer.alloc(0);
  private policyState = createStreamingAgentPolicyState();

  constructor(private readonly registry: ProtoRegistry) {}

  feedChunk(chunk: Buffer): FeedChunkResult {
    if (chunk.length === 0) {
      return { liveUpdates: [], turnEndedEvents: [] };
    }

    this.buffer = Buffer.concat([this.buffer, chunk]);
    const liveUpdates: LiveTokenUpdate[] = [];
    const turnEndedEvents: TurnEndedEvent[] = [];

    let offset = 0;
    while (offset < this.buffer.length) {
      const frame = tryConnectFrame(this.buffer, offset);
      if (!frame) {
        if (this.isIncompleteFrameAt(offset)) {
          break;
        }
        offset += 1;
        continue;
      }

      const decoded = decodeAgentServerPayload(this.registry, frame.payload);
      offset = frame.nextOffset;

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

    this.buffer = offset > 0 ? this.buffer.subarray(offset) : this.buffer;
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
      bufferLength: this.buffer.length,
      messageCount: this.policyState.messageCount,
      accumulatedTokens: this.policyState.accumulatedTokens,
      relationshipIds: { ...this.policyState.relationshipIds },
    };
  }

  private isIncompleteFrameAt(offset: number): boolean {
    if (offset + 5 > this.buffer.length) {
      return true;
    }

    const length = this.buffer.readUInt32BE(offset + 1);
    return (
      length > 0 &&
      length <= MAX_CONNECT_FRAME_BYTES &&
      offset + 5 + length > this.buffer.length
    );
  }

  private resetStreamState(): void {
    this.buffer = Buffer.alloc(0);
    this.policyState = createStreamingAgentPolicyState();
  }
}
