import type { AgentSessionInfo } from '../../proxy/proxyInsightExtractor';
import type {
  DetectedTurn,
  ITokenTurnDetectionService,
} from '../ports/ITokenTurnDetectionService';

export const RESET_PEAK_THRESHOLD = 300;
export const RESET_DROP_THRESHOLD = 150;

/**
 * Detect token counter resets in streaming token_delta sequences.
 * Ported from agentLiveUsageStatusBar turn tracking heuristic.
 */
export class TokenTurnDetectionService implements ITokenTurnDetectionService {
  detectTurns(frames: AgentSessionInfo[]): DetectedTurn[] {
    const turns: DetectedTurn[] = [];
    let currentPeak = 0;
    let turnIndex = 0;

    for (const frame of frames) {
      if (frame.usageEvent !== 'token_delta' || frame.streamingTokens == null) {
        continue;
      }

      const tokens = frame.streamingTokens;

      if (
        currentPeak >= RESET_PEAK_THRESHOLD &&
        tokens <= RESET_DROP_THRESHOLD
      ) {
        turns.push({ streamingTokens: currentPeak, turnIndex });
        turnIndex += 1;
        currentPeak = tokens;
      } else if (tokens > currentPeak) {
        currentPeak = tokens;
      }
    }

    if (currentPeak > 0) {
      turns.push({ streamingTokens: currentPeak, turnIndex });
    }

    return turns;
  }
}
