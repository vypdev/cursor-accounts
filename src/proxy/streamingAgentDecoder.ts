import {
  decodeAgentServerPayload,
  tryConnectFrame,
} from './agentStreamDecode';
import type { ProtoRegistry } from './protoRegistry';
import {
  extractAgentInnerInsights,
  extractConversationAndSubagentIds,
  mergeAgentSessionInfo,
  type AgentSessionInfo,
} from './proxyInsightExtractor';

const MAX_CONNECT_FRAME_BYTES = 5_000_000;

export interface StreamingDecoderState {
  bufferLength: number;
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
  agent: AgentSessionInfo;
}

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
  private messageCount = 0;
  private accumulatedTokens = 0;
  private relationshipIds: Partial<AgentSessionInfo> = {};

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

      this.messageCount += 1;

      const ids = extractConversationAndSubagentIds(decoded);
      if (Object.keys(ids).length > 0) {
        this.relationshipIds =
          mergeAgentSessionInfo(this.relationshipIds, ids) ??
          this.relationshipIds;
      }

      const insight = extractAgentInnerInsights(decoded);
      if (!insight) {
        continue;
      }

      if (insight.usageEvent === 'token_delta' && insight.streamingTokens != null) {
        const latestDelta = insight.streamingTokens;
        this.accumulatedTokens += latestDelta;
        liveUpdates.push({
          accumulatedTokens: this.accumulatedTokens,
          latestDelta,
          agent: this.mergeAgentInsight({
            streamingTokens: this.accumulatedTokens,
            usageEvent: 'token_delta',
            eventSequence: this.messageCount,
          }),
        });
        continue;
      }

      if (insight.usageEvent === 'turn_ended') {
        const inputTokens = insight.inputTokens ?? 0;
        const outputTokens = insight.outputTokens ?? 0;
        turnEndedEvents.push({
          inputTokens,
          outputTokens,
          cacheReadTokens: insight.cacheReadTokens,
          cacheWriteTokens: insight.cacheWriteTokens,
          totalCents: insight.totalCents,
          agent: this.mergeAgentInsight({
            inputTokens: insight.inputTokens,
            outputTokens: insight.outputTokens,
            cacheReadTokens: insight.cacheReadTokens,
            cacheWriteTokens: insight.cacheWriteTokens,
            totalCents: insight.totalCents,
            usageEvent: 'turn_ended',
            eventSequence: this.messageCount,
          }),
        });
        this.accumulatedTokens = 0;
        continue;
      }

      if (insight.usageEvent === 'token_details') {
        liveUpdates.push({
          accumulatedTokens: this.accumulatedTokens,
          latestDelta: 0,
          agent: this.mergeAgentInsight({
            ...insight,
            eventSequence: this.messageCount,
          }),
        });
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
      messageCount: this.messageCount,
      accumulatedTokens: this.accumulatedTokens,
      relationshipIds: { ...this.relationshipIds },
    };
  }

  private mergeAgentInsight(
    partial: Partial<AgentSessionInfo>
  ): AgentSessionInfo {
    return (
      mergeAgentSessionInfo(this.relationshipIds, partial) ?? {
        ...partial,
        usageEvent: partial.usageEvent ?? 'token_delta',
      }
    );
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
    this.messageCount = 0;
    this.accumulatedTokens = 0;
    this.relationshipIds = {};
  }
}
