import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractBillingInfo,
  extractConversationContext,
  extractInsightsForRpc,
  extractTokenUsage,
  redactSensitive,
} from '../proxy/proxyInsightExtractor';

describe('proxyInsightExtractor', () => {
  it('extracts billing from Connect JSON camelCase', () => {
    const billing = extractBillingInfo({
      billingCycleStart: '1780348749000',
      billingCycleEnd: '1782940749000',
      planUsage: { limit: 7000, totalSpend: 17413 },
      spendLimitUsage: { limitType: 'user' },
    });

    assert.ok(billing?.billingCycleStart);
    assert.equal(billing?.planUsage?.limit, 7000);
  });

  it('extracts billing from usage response shape', () => {
    const billing = extractBillingInfo({
      billing_cycle_start: '1700000000',
      billing_cycle_end: '1702592000',
      plan_usage: {
        slow_premium_requests_count: 1,
        fast_premium_requests_count: 2,
        plan_request_count_limit: 500,
      },
      spend_limit_usage: {
        spend_usd_cents: 1250,
        spend_limit_usd_cents: 5000,
      },
    });

    assert.ok(billing?.billingCycleStart);
    assert.equal(billing?.planUsage?.limit, 500);
    assert.equal(billing?.spendLimit?.currentSpendUsd, 12.5);
  });

  it('extracts token usage from metadata', () => {
    const tokens = extractTokenUsage({
      metadata: {
        model_name: 'gpt-4',
        token_usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      },
    });

    assert.equal(tokens?.modelName, 'gpt-4');
    assert.equal(tokens?.totalTokens, 30);
  });

  it('extracts conversation context', () => {
    const ctx = extractConversationContext({
      conversation_id: 'conv-1',
      conversation_messages: [
        {
          user_context: {
            files: [{ path: '/src/a.ts' }],
          },
        },
      ],
    });

    assert.equal(ctx?.conversationId, 'conv-1');
    assert.equal(ctx?.messageCount, 1);
    assert.deepEqual(ctx?.includedFiles, ['/src/a.ts']);
  });

  it('redacts sensitive fields', () => {
    const out = redactSensitive({
      token: 'secret',
      nested: { api_key: 'x', ok: 1 },
    }) as Record<string, unknown>;

    assert.equal(out.token, '[REDACTED]');
    assert.equal((out.nested as Record<string, unknown>).api_key, '[REDACTED]');
    assert.equal((out.nested as Record<string, unknown>).ok, 1);
  });

  it('picks insights by rpc path', () => {
    const insights = extractInsightsForRpc(
      '/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
      { billing_cycle_start: '1', plan_usage: {} }
    );
    assert.ok(insights?.billing);
  });

  it('picks agent insights for RunPoll', () => {
    const insights = extractInsightsForRpc('/agent.v1.AgentService/RunPoll', {
      request_id: { request_id: 'agent-req-99' },
      seqno: '3',
    });
    assert.equal(insights?.agent?.requestId, 'agent-req-99');
    assert.equal(insights?.agent?.pollSeqno, 3);
  });
});
