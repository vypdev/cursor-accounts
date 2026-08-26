import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyAgentIngestion,
  createIngestTrafficResult,
  normalizeAgentTimestamp,
  selectAgentModelName,
} from '../../application/services/agentTrackingIngestionPolicy';
import type { ProxyTrafficUsageEvent } from '../../domain/types/proxyTraffic';

const baseSummary = {
  timestamp: '2026-08-26T00:00:00.000Z',
  url: 'https://agent.cursor.sh/RunSSE',
  endpoint: '/RunSSE',
} satisfies ProxyTrafficUsageEvent;

describe('agent tracking ingestion policy', () => {
  it('classifies live updates before turn-ended and batch events', () => {
    assert.equal(
      classifyAgentIngestion({ ...baseSummary, isLiveTokenUpdate: true, isTurnEnded: true }),
      'live'
    );
    assert.equal(classifyAgentIngestion({ ...baseSummary, isTurnEnded: true }), 'turn_ended');
    assert.equal(classifyAgentIngestion(baseSummary), 'batch');
  });

  it('normalizes valid and invalid timestamps with an injected fallback clock', () => {
    assert.equal(
      normalizeAgentTimestamp('1970-01-01T00:16:40.999Z', 99_999),
      1_000
    );
    assert.equal(normalizeAgentTimestamp('not-a-date', 1_234.9), 1_234);
  });

  it('prefers the token insight model over the agent model', () => {
    assert.equal(
      selectAgentModelName(
        { tokens: { modelName: 'token-model' } },
        { requestId: 'request', modelName: 'agent-model' }
      ),
      'token-model'
    );
    assert.equal(
      selectAgentModelName({}, { requestId: 'request', modelName: 'agent-model' }),
      'agent-model'
    );
  });

  it('maps persistence strategies to the public result and ignores snapshots', () => {
    assert.deepEqual(createIngestTrafficResult('conversation', 'turn_ended', true), {
      conversationId: 'conversation',
      deltaPersisted: false,
      turnEndedPersisted: true,
      contextPersisted: false,
    });
    assert.deepEqual(createIngestTrafficResult('conversation', 'context', false), {
      conversationId: 'conversation',
      deltaPersisted: false,
      turnEndedPersisted: false,
      contextPersisted: true,
    });
    assert.deepEqual(createIngestTrafficResult('conversation', 'live_delta', true), {
      conversationId: 'conversation',
      deltaPersisted: true,
      turnEndedPersisted: false,
      contextPersisted: true,
    });
    assert.deepEqual(createIngestTrafficResult('conversation', 'batch', false), {
      conversationId: 'conversation',
      deltaPersisted: true,
      turnEndedPersisted: false,
      contextPersisted: false,
    });
    assert.equal(createIngestTrafficResult('conversation', 'snapshot', false), undefined);
  });
});
