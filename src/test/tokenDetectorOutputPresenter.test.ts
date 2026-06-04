import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatTokenDetectorLine,
} from '../proxy/tokenDetectorOutputPresenter';
import type { ProxyTrafficSummary } from '../proxy/types';

describe('tokenDetectorOutputPresenter', () => {
  it('formats agent token events with conversation and request ids', () => {
    const line = formatTokenDetectorLine(
      {
        timestamp: new Date('2026-06-04T01:01:23Z').toISOString(),
        kind: 'response',
        url: 'https://api2.cursor.sh/agent.v1.AgentService/RunPoll',
        host: 'api2.cursor.sh',
        endpoint: '/agent.v1.AgentService/RunPoll',
        rpcPath: '/agent.v1.AgentService/RunPoll',
        insights: {
          agent: {
            requestId: 'a64646d2-6f99-4227-8b3a-123456789abc',
            conversationId: 'b0f1e6a4-45ad-4060-a753-5c2f7f5c91d9',
            streamingTokens: 121,
            usageEvent: 'token_delta',
          },
          tokens: {
            modelName: 'claude-4-sonnet',
          },
        },
      } satisfies ProxyTrafficSummary,
      '74d289a7'
    );

    assert.ok(line);
    assert.match(line!, /\[TokenDetector\]/);
    assert.match(line!, /conv=b0f1e6a4-45/);
    assert.match(line!, /agent=a64646d2-6f9/);
    assert.match(line!, /stream=121/);
    assert.match(line!, /event=token_delta/);
    assert.match(line!, /model=claude-4-sonnet/);
  });

  it('returns null for unrelated traffic', () => {
    const line = formatTokenDetectorLine({
      timestamp: new Date().toISOString(),
      kind: 'response',
      url: 'https://example.com/health',
      host: 'example.com',
      endpoint: '/health',
      statusCode: 200,
    } satisfies ProxyTrafficSummary);

    assert.equal(line, null);
  });

  it('formats RunSSE token_delta from stream scan insights', () => {
    const line = formatTokenDetectorLine(
      {
        timestamp: new Date('2026-06-04T01:01:23Z').toISOString(),
        kind: 'response',
        url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
        host: 'agent.api5.cursor.sh',
        endpoint: '/agent.v1.AgentService/RunSSE',
        rpcPath: '/agent.v1.AgentService/RunSSE',
        insights: {
          agent: {
            conversationId: 'b0f1e6a4-45ad-4060-a753-5c2f7f5c91d9',
            streamingTokens: 603,
            usageEvent: 'token_delta',
          },
        },
      } satisfies ProxyTrafficSummary,
      '74d289a7'
    );

    assert.ok(line);
    assert.match(line!, /stream=603/);
    assert.match(line!, /event=token_delta/);
    assert.match(line!, /RunSSE/);
  });
});
