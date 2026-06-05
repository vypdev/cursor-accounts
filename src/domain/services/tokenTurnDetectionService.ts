import type { AgentSessionInfo } from '../../application/types/agentTracking';
import type {
  DetectedTurn,
  ITokenTurnDetectionService,
} from '../ports/ITokenTurnDetectionService';

export const RESET_PEAK_THRESHOLD = 300;
export const RESET_DROP_THRESHOLD = 150;

export interface TurnDetectorState {
  currentPeak: number;
  turnIndex: number;
}

/**
 * Detect token counter resets in streaming token_delta sequences.
 * @deprecated Prefer server `turn_ended` events for turn boundaries; kept for batch offline decode.
 */
export class TokenTurnDetectionService implements ITokenTurnDetectionService {
  detectTurns(frames: AgentSessionInfo[]): DetectedTurn[] {
    const state: TurnDetectorState = { currentPeak: 0, turnIndex: 0 };
    const turns: DetectedTurn[] = [];

    for (const frame of frames) {
      const completed = this.processFrame(frame, state);
      if (completed) {
        turns.push(completed);
      }
    }

    if (state.currentPeak > 0) {
      turns.push({
        streamingTokens: state.currentPeak,
        turnIndex: state.turnIndex,
      });
    }

    return turns;
  }

  /** Process one token_delta frame; returns a completed turn when reset is detected. */
  processFrame(
    frame: AgentSessionInfo,
    state: TurnDetectorState
  ): DetectedTurn | null {
    if (frame.usageEvent !== 'token_delta' || frame.streamingTokens == null) {
      return null;
    }

    const tokens = frame.streamingTokens;

    if (
      state.currentPeak >= RESET_PEAK_THRESHOLD &&
      tokens <= RESET_DROP_THRESHOLD
    ) {
      const turn: DetectedTurn = {
        streamingTokens: state.currentPeak,
        turnIndex: state.turnIndex,
      };
      state.turnIndex += 1;
      state.currentPeak = tokens;
      return turn;
    }

    if (tokens > state.currentPeak) {
      state.currentPeak = tokens;
    }

    return null;
  }
}
