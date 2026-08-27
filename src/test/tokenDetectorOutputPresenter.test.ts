import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatTokenDetectorLine,
} from '../ui/presentation/tokenDetectorOutputPresenter';
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

  it('formats final token breakdown and session relationships', () => {
    const line = formatTokenDetectorLine(
      {
        timestamp: new Date('2026-06-04T01:01:23Z').toISOString(),
        kind: 'response',
        url: 'https://api2.cursor.sh/agent.v1.AgentService/RunPoll',
        host: 'api2.cursor.sh',
        endpoint: '/agent.v1.AgentService/RunPoll',
        insights: {
          agent: {
            requestId: 'request-123456789',
            parentRequestId: 'parent-123456789',
            subagentRequestId: 'subagent-123456789',
            conversationGroupId: 'group-123456789',
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 25,
            cacheWriteTokens: 5,
            estimatedCostUsd: 0.1256,
            eof: true,
          },
        },
      } satisfies ProxyTrafficSummary,
      'profile-123456789'
    );

    assert.ok(line);
    assert.match(line!, /profile=profile-/);
    assert.match(line!, /group=group-1234/);
    assert.match(line!, /agent=request-123/);
    assert.match(line!, /parent=parent-1/);
    assert.match(line!, /subagent=subagent-/);
    assert.match(line!, /in=100/);
    assert.match(line!, /out=50/);
    assert.match(line!, /cacheR=25/);
    assert.match(line!, /cacheW=5/);
    assert.match(line!, /~\$0\.126/);
    assert.match(line!, /eof/);
  });

  it('uses context identifiers and total token fallback when agent totals are absent', () => {
    const line = formatTokenDetectorLine({
      timestamp: new Date().toISOString(),
      kind: 'error',
      url: 'https://api2.cursor.sh/agent.v1.AgentService/RunPoll',
      host: 'api2.cursor.sh',
      endpoint: '/agent.v1.AgentService/RunPoll',
      rpcPath: '///agent.v1.AgentService/RunPoll',
      decodeError: 'invalid frame',
      insights: {
        tokens: {
          modelName: 'gpt-4.1',
          totalTokens: 321,
        },
        context: {
          conversationId: 'conversation-123456789',
          conversationGroupId: 'context-group-123456789',
        },
      },
    } satisfies ProxyTrafficSummary);

    assert.ok(line);
    assert.match(line!, /rpc=agent\.v1\.AgentService\/RunPoll/);
    assert.doesNotMatch(line!, /← resp|→ req/);
    assert.match(line!, /conv=conversation/);
    assert.match(line!, /group=context-grou/);
    assert.match(line!, /model=gpt-4\.1/);
    assert.match(line!, /total=321/);
    assert.match(line!, /decodeErr=invalid frame/);
  });

  it('prefers agent model and keeps zero estimated cost absent', () => {
    const line = formatTokenDetectorLine({
      timestamp: new Date().toISOString(),
      kind: 'request',
      url: 'https://api2.cursor.sh/agent.v1.BidiService/BidiAppend',
      host: 'api2.cursor.sh',
      endpoint: '/agent.v1.BidiService/BidiAppend',
      insights: {
        agent: {
          modelName: 'agent-model',
          estimatedCostUsd: 0,
          usageEvent: 'token_details',
        },
        tokens: {
          modelName: 'token-model',
        },
      },
    } satisfies ProxyTrafficSummary);

    assert.ok(line);
    assert.match(line!, /model=token-model/);
    assert.doesNotMatch(line!, /agent-model/);
    assert.doesNotMatch(line!, /~\$/);
    assert.match(line!, /event=token_details/);
    assert.match(line!, /→ req/);
  });

  it('does not emit an empty line for an agent RPC without useful insights', () => {
    const line = formatTokenDetectorLine({
      timestamp: new Date().toISOString(),
      kind: 'response',
      url: 'https://api2.cursor.sh/agent.v1.AgentService/RunPoll',
      host: 'api2.cursor.sh',
      endpoint: '/agent.v1.AgentService/RunPoll',
    } satisfies ProxyTrafficSummary);

    assert.equal(line, null);
  });
});
