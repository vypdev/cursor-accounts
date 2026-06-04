import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RESET_DROP_THRESHOLD,
  RESET_PEAK_THRESHOLD,
  TokenTurnDetectionService,
} from '../../domain/services/tokenTurnDetectionService';
import type { AgentSessionInfo } from '../../proxy/proxyInsightExtractor';

function delta(tokens: number): AgentSessionInfo {
  return { streamingTokens: tokens, usageEvent: 'token_delta' };
}

describe('TokenTurnDetectionService', () => {
  const service = new TokenTurnDetectionService();

  it('detects a single turn with no reset', () => {
    const turns = service.detectTurns([
      delta(10),
      delta(50),
      delta(250),
    ]);

    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.streamingTokens, 250);
    assert.equal(turns[0]?.turnIndex, 0);
  });

  it('detects reset when peak >= threshold and drop <= threshold', () => {
    const turns = service.detectTurns([
      delta(300),
      delta(100),
      delta(200),
    ]);

    assert.equal(turns.length, 2);
    assert.equal(turns[0]?.streamingTokens, 300);
    assert.equal(turns[0]?.turnIndex, 0);
    assert.equal(turns[1]?.streamingTokens, 200);
    assert.equal(turns[1]?.turnIndex, 1);
  });

  it('detects multiple turns in a longer sequence', () => {
    const turns = service.detectTurns([
      delta(10),
      delta(50),
      delta(300),
      delta(150),
      delta(20),
      delta(400),
      delta(100),
      delta(120),
    ]);

    assert.equal(turns.length, 3);
    assert.equal(turns[0]?.streamingTokens, 300);
    assert.equal(turns[1]?.streamingTokens, 400);
    assert.equal(turns[2]?.streamingTokens, 120);
    assert.deepEqual(
      turns.map((turn) => turn.turnIndex),
      [0, 1, 2]
    );
  });

  it('returns empty array when no token_delta frames exist', () => {
    const turns = service.detectTurns([
      { inputTokens: 100, outputTokens: 50, usageEvent: 'turn_ended' },
    ]);
    assert.deepEqual(turns, []);
  });

  it('uses documented reset thresholds', () => {
    assert.equal(RESET_PEAK_THRESHOLD, 300);
    assert.equal(RESET_DROP_THRESHOLD, 150);
  });
});
