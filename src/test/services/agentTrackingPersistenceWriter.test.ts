import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IAgentTrackingRepository } from '../../domain/ports/IAgentTrackingRepository';
import type { DetectedTurn, ITokenTurnDetectionService } from '../../domain/ports/ITokenTurnDetectionService';
import type {
  TokenDeltaMinuteRecord,
  TokenSnapshotRecord,
  TurnEndedRecord,
} from '../../domain/types/agentPersistence';
import type { AgentPersistenceContext } from '../../application/services/agentTrackingPersistenceTypes';
import { AgentTrackingPersistenceWriter } from '../../application/services/agentTrackingPersistenceWriter';

class RecordingRepository implements IAgentTrackingRepository {
  deltas: TokenDeltaMinuteRecord[] = [];
  snapshots: TokenSnapshotRecord[] = [];
  turnEnded: TurnEndedRecord[] = [];

  async initialize() {}
  async upsertConversation() {}
  async upsertAgent() {}

  async insertTokenSnapshot(record: Omit<TokenSnapshotRecord, 'id'>) {
    this.snapshots.push(record);
  }

  async upsertTokenDelta(record: TokenDeltaMinuteRecord) {
    this.deltas.push(record);
  }

  async insertTurnEnded(record: Omit<TurnEndedRecord, 'id'>) {
    this.turnEnded.push(record);
  }

  async getTotalConversationTokens() {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalTokens: 0,
      totalDeltaTokens: 0,
      totalDeltaCostCents: 0,
      totalTurnCostCents: 0,
      deltaMinuteBuckets: 0,
      agentCount: 0,
      models: [],
      startedAt: 0,
      endedAt: 0,
    };
  }

  async getTotalDeltaTokensByConversation() {
    return { totalStreamingTokens: 0, totalCostCents: 0, minuteBuckets: 0 };
  }

  async getTurnEndedByConversation() {
    return [];
  }

  async getAgentTokens() {
    return null;
  }

  async getAgentTree() {
    return [];
  }

  async getDatabaseSize() {
    return 0;
  }

  async deleteOldConversations() {
    return 0;
  }
}

function createContext(
  overrides: Partial<AgentPersistenceContext> = {}
): AgentPersistenceContext {
  return {
    summary: {
      timestamp: new Date(120_000).toISOString(),
      url: 'https://agent.cursor.sh/agent',
      endpoint: '/agent',
    },
    insights: {},
    agent: { requestId: 'request-1' },
    timestamp: 120,
    modelName: 'composer-2.5',
    ...overrides,
  };
}

describe('AgentTrackingPersistenceWriter', () => {
  it('writes a live delta using the precomputed cost', async () => {
    const repository = new RecordingRepository();
    const writer = new AgentTrackingPersistenceWriter(repository);
    const context = createContext({
      summary: {
        ...createContext().summary,
        isLiveTokenUpdate: true,
        liveTokenData: {
          accumulatedTokens: 42,
          latestDelta: 12,
          deltaCostCents: 0.25,
        },
      },
      agent: { requestId: 'request-1', usageEvent: 'token_delta' },
    });

    assert.equal(await writer.writeLiveDelta(context), true);
    assert.deepEqual(
      repository.deltas.map(
        ({ requestId, minuteBucket, streamingTokens, costCents, modelName }) => ({
          requestId,
          minuteBucket,
          streamingTokens,
          costCents,
          modelName,
        })
      ),
      [
        {
          requestId: 'request-1',
          minuteBucket: 120,
          streamingTokens: 12,
          costCents: 0.25,
          modelName: 'composer-2.5',
        },
      ]
    );
  });

  it('reports a zero live delta without writing a repository row', async () => {
    const repository = new RecordingRepository();
    const writer = new AgentTrackingPersistenceWriter(repository);
    const context = createContext({
      summary: {
        ...createContext().summary,
        isLiveTokenUpdate: true,
        liveTokenData: { accumulatedTokens: 42, latestDelta: 0 },
      },
      agent: { requestId: 'request-1', usageEvent: 'token_delta' },
    });

    assert.equal(await writer.writeLiveDelta(context), false);
    assert.equal(repository.deltas.length, 0);
  });

  it('writes each detected turn as a snapshot', async () => {
    const repository = new RecordingRepository();
    const turnDetection: ITokenTurnDetectionService = {
      detectTurns() {
        return [
          { streamingTokens: 300, turnIndex: 0 },
          { streamingTokens: 200, turnIndex: 1 },
        ] satisfies DetectedTurn[];
      },
    };
    const writer = new AgentTrackingPersistenceWriter(repository, turnDetection);
    const context = createContext({
      summary: { ...createContext().summary, httpRequestId: 'http-1' },
      insights: {
        allTokenFrames: [
          { streamingTokens: 300, usageEvent: 'token_delta' },
          { streamingTokens: 200, usageEvent: 'token_delta' },
        ],
      },
    });

    assert.equal(await writer.writeDetectedTurns(context), true);
    assert.deepEqual(
      repository.snapshots.map(({ turnIndex, streamingTokens, httpRequestId }) => ({
        turnIndex,
        streamingTokens,
        httpRequestId,
      })),
      [
        { turnIndex: 0, streamingTokens: 300, httpRequestId: 'http-1' },
        { turnIndex: 1, streamingTokens: 200, httpRequestId: 'http-1' },
      ]
    );
  });

  it('does not write a turn-ended row when final token counts are absent', async () => {
    const repository = new RecordingRepository();
    const writer = new AgentTrackingPersistenceWriter(repository);

    assert.equal(await writer.writeTurnEnded(createContext()), false);
    assert.equal(repository.turnEnded.length, 0);
  });

  it('uses model-aware pricing when the server omits turn cost', async () => {
    const repository = new RecordingRepository();
    const writer = new AgentTrackingPersistenceWriter(repository, undefined, {
      calculateDeltaCost: () => 0,
      calculateTurnCost: (breakdown, modelId) => {
        assert.deepEqual(breakdown, {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 20,
          cacheWriteTokens: undefined,
        });
        assert.equal(modelId, 'model-from-agent');
        return 1.25;
      },
    });

    assert.equal(
      await writer.writeTurnEnded(
        createContext({
          agent: {
            requestId: 'request-1',
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 20,
            modelName: 'model-from-agent',
            usageEvent: 'turn_ended',
          },
        })
      ),
      true
    );
    assert.equal(repository.turnEnded[0]?.totalCents, 1.25);
  });

  it('keeps a valid server turn cost authoritative', async () => {
    const repository = new RecordingRepository();
    const writer = new AgentTrackingPersistenceWriter(repository, undefined, {
      calculateDeltaCost: () => 0,
      calculateTurnCost: () => 999,
    });

    await writer.writeTurnEnded(
      createContext({
        agent: {
          requestId: 'request-1',
          inputTokens: 100,
          outputTokens: 50,
          totalCents: 4.5,
          usageEvent: 'turn_ended',
        },
      })
    );

    assert.equal(repository.turnEnded[0]?.totalCents, 4.5);
  });

  it('persists a cache-only completion when no input/output split is present', async () => {
    const repository = new RecordingRepository();
    const writer = new AgentTrackingPersistenceWriter(repository);

    assert.equal(
      await writer.writeTurnEnded(
        createContext({
          agent: {
            requestId: 'request-1',
            cacheReadTokens: 25,
            usageEvent: 'turn_ended',
          },
        })
      ),
      true
    );
    assert.equal(repository.turnEnded[0]?.inputTokens, 0);
    assert.equal(repository.turnEnded[0]?.cacheReadTokens, 25);
  });
});
