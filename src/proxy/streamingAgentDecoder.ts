import type { DetectedTurn } from '../domain/ports/ITokenTurnDetectionService';
import {
  RESET_DROP_THRESHOLD,
  RESET_PEAK_THRESHOLD,
  TokenTurnDetectionService,
  type TurnDetectorState,
} from '../domain/services/tokenTurnDetectionService';
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
  turnIndex: number;
  currentPeak: number;
  relationshipIds: Partial<AgentSessionInfo>;
}

export interface CompletedTurn {
  turn: DetectedTurn;
  agent: AgentSessionInfo;
  allFrames: AgentSessionInfo[];
}

/**
 * Incrementally decodes Connect-framed RunSSE / StreamBidi response chunks.
 */
export class StreamingAgentDecoder {
  private buffer = Buffer.alloc(0);
  private messageCount = 0;
  private relationshipIds: Partial<AgentSessionInfo> = {};
  private currentTurnFrames: AgentSessionInfo[] = [];
  private readonly turnState: TurnDetectorState = {
    currentPeak: 0,
    turnIndex: 0,
  };
  private readonly turnDetection = new TokenTurnDetectionService();

  constructor(private readonly registry: ProtoRegistry) {}

  feedChunk(chunk: Buffer): CompletedTurn[] {
    if (chunk.length === 0) {
      return [];
    }

    this.buffer = Buffer.concat([this.buffer, chunk]);
    const completed: CompletedTurn[] = [];

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
        this.relationshipIds = { ...this.relationshipIds, ...ids };
      }

      const insight = extractAgentInnerInsights(decoded);
      if (!insight || insight.usageEvent !== 'token_delta') {
        continue;
      }

      this.currentTurnFrames.push(insight);
      const completedTurn = this.turnDetection.processFrame(
        insight,
        this.turnState
      );
      if (completedTurn) {
        const turnFrames = this.currentTurnFrames.slice(
          0,
          -1
        );
        completed.push(
          this.buildCompletedTurn(completedTurn, turnFrames)
        );
        this.currentTurnFrames = [insight];
      }
    }

    this.buffer = offset > 0 ? this.buffer.subarray(offset) : this.buffer;
    return completed;
  }

  finalize(): CompletedTurn | null {
    if (this.turnState.currentPeak <= 0) {
      this.reset();
      return null;
    }

    const turn: DetectedTurn = {
      streamingTokens: this.turnState.currentPeak,
      turnIndex: this.turnState.turnIndex,
    };
    const completed = this.buildCompletedTurn(turn, this.currentTurnFrames);
    this.reset();
    return completed;
  }

  getState(): StreamingDecoderState {
    return {
      bufferLength: this.buffer.length,
      messageCount: this.messageCount,
      turnIndex: this.turnState.turnIndex,
      currentPeak: this.turnState.currentPeak,
      relationshipIds: { ...this.relationshipIds },
    };
  }

  private buildCompletedTurn(
    turn: DetectedTurn,
    frames: AgentSessionInfo[]
  ): CompletedTurn {
    const agent = mergeAgentSessionInfo(this.relationshipIds, {
      streamingTokens: turn.streamingTokens,
      usageEvent: 'token_delta',
    }) ?? {
      streamingTokens: turn.streamingTokens,
      usageEvent: 'token_delta' as const,
    };

    return {
      turn,
      agent,
      allFrames: frames.length > 0 ? frames : [{ ...agent }],
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

  private reset(): void {
    this.buffer = Buffer.alloc(0);
    this.messageCount = 0;
    this.relationshipIds = {};
    this.currentTurnFrames = [];
    this.turnState.currentPeak = 0;
    this.turnState.turnIndex = 0;
  }
}

export {
  RESET_DROP_THRESHOLD,
  RESET_PEAK_THRESHOLD,
};
