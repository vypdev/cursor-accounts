import type { AgentSessionInfo } from '../../application/types/agentTracking';

export interface DetectedTurn {
  streamingTokens: number;
  turnIndex: number;
}

/**
 * Domain service for detecting token counter resets within streaming responses.
 * Implements peak/reset heuristic: peak >= 300 + drop <= 150 = new turn.
 */
export interface ITokenTurnDetectionService {
  detectTurns(frames: AgentSessionInfo[]): DetectedTurn[];
}
