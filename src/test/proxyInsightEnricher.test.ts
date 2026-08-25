import './registerVscodeMock';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentSessionInfo } from '../domain/types/agentTracking';
import type { ProxyInsights } from '../domain/types/proxyInsights';
import { applyAgentSessionInsights, finalizeInsights } from '../proxy/proxyInsightEnricher';

describe('proxyInsightEnricher', () => {
  it('returns existing insights when no agent data is available', () => {
    const insights: ProxyInsights = { context: { conversationId: 'conv-1' } };

    assert.equal(applyAgentSessionInsights(insights, undefined), insights);
  });

  it('merges completed token usage and calculates total tokens', () => {
    const agent: AgentSessionInfo = {
      requestId: 'req-1',
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 10,
      totalCents: 4,
    };

    assert.deepEqual(
      applyAgentSessionInsights(
        { context: { conversationId: 'conv-1' } },
        agent
      ),
      {
        context: { conversationId: 'conv-1' },
        agent,
        tokens: {
          promptTokens: 120,
          completionTokens: 30,
          totalTokens: 150,
          cachedTokens: 10,
          totalCents: 4,
        },
      }
    );
  });

  it('publishes streaming token totals when final counts are absent', () => {
    assert.deepEqual(
      applyAgentSessionInsights(undefined, { streamingTokens: 17 }),
      {
        agent: { streamingTokens: 17 },
        tokens: { totalTokens: 17 },
      }
    );
  });

  it('does not enrich error-direction entries', async () => {
    const insights: ProxyInsights = { agent: { requestId: 'req-1' } };

    assert.deepEqual(
      await finalizeInsights(
        '/agent.v1.BidiService/BidiPoll',
        'error',
        Buffer.alloc(0),
        undefined,
        {},
        insights
      ),
      insights
    );
  });
});
