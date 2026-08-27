import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractBillingInfo,
  extractAgentInnerInsights,
  extractAgentRunRequestInfo,
  extractConversationAndSubagentIds,
  extractConversationContext,
  definedAgentFields,
  estimateTokenCostUsd,
  extractInsightsForRpc,
  extractTokenUsage,
  mergeAgentSessionInfo,
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

  it('extracts token usage totalCents from metadata', () => {
    const tokens = extractTokenUsage({
      metadata: {
        model_name: 'gpt-4',
        token_usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_cents: 45.5,
        },
      },
    });

    assert.equal(tokens?.totalCents, 45.5);
  });

  it('preserves explicit cache fields from direct usage shapes', () => {
    const tokens = extractTokenUsage({
      input_tokens: 100,
      output_tokens: 25,
      cache_read_tokens: 40,
      cache_write_tokens: 5,
      total_tokens: 170,
      total_cents: 2.5,
    });

    assert.deepEqual(tokens, {
      promptTokens: 100,
      completionTokens: 25,
      cachedTokens: 40,
      cacheReadTokens: 40,
      cacheWriteTokens: 5,
      totalTokens: 170,
      totalCents: 2.5,
    });
  });

  it('preserves cache read/write fields from nested camelCase usage shapes', () => {
    const tokens = extractTokenUsage({
      metadata: {
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 25,
          cacheReadTokens: 40,
          cacheWriteTokens: 5,
        },
      },
    });

    assert.equal(tokens?.promptTokens, 100);
    assert.equal(tokens?.completionTokens, 25);
    assert.equal(tokens?.cachedTokens, 40);
    assert.equal(tokens?.cacheReadTokens, 40);
    assert.equal(tokens?.cacheWriteTokens, 5);
  });

  it('extracts model from runRequest via extractAgentRunRequestInfo', () => {
    const info = extractAgentRunRequestInfo({
      runRequest: {
        requestId: 'req-model-1',
        requestedModel: { modelId: 'composer-2.5' },
        modelDetails: { displayName: 'Composer 2.5' },
        subagentTypeName: 'explore',
      },
    });

    assert.equal(info?.requestId, 'req-model-1');
    assert.equal(info?.requestedModelId, 'composer-2.5');
    assert.equal(info?.modelDisplayName, 'Composer 2.5');
    assert.equal(info?.subagentTypeName, 'explore');
  });

  it('maps total_cents from agent turn_ended when present on wire', () => {
    const insight = extractAgentInnerInsights({
      interactionUpdate: {
        turnEnded: {
          inputTokens: 1200,
          outputTokens: 300,
          total_cents: 102,
        },
      },
    });

    assert.equal(insight?.usageEvent, 'turn_ended');
    assert.equal(insight?.inputTokens, 1200);
    assert.equal(insight?.totalCents, 102);
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

  it('extracts workspace info from agent rpc payloads', () => {
    const insights = extractInsightsForRpc('/agent.v1.AgentService/BidiAppend', {
      workspace_id: 'ws-123',
      workspace_root_path: '/Users/dev/project',
      relative_workspace_path: 'project',
    });
    assert.equal(insights?.workspace?.workspaceId, 'ws-123');
    assert.equal(insights?.workspace?.workspaceRootPath, '/Users/dev/project');
    assert.equal(insights?.workspace?.relativeWorkspacePath, 'project');
  });

  it('extracts conversation and subagent ids from runRequest', () => {
    const ids = extractConversationAndSubagentIds({
      runRequest: {
        conversationId: 'conv-abc',
        conversationGroupId: 'group-1',
        parentRequestId: 'req-parent',
        subagentRequestId: 'req-sub',
      },
    });

    assert.equal(ids.conversationId, 'conv-abc');
    assert.equal(ids.conversationGroupId, 'group-1');
    assert.equal(ids.parentRequestId, 'req-parent');
    assert.equal(ids.subagentRequestId, 'req-sub');
  });

  it('extracts subagent id from subagentResult.success', () => {
    const ids = extractConversationAndSubagentIds({
      subagentResult: {
        success: {
          agentId: 'sub-agent-1',
        },
      },
    });

    assert.equal(ids.subagentRequestId, 'sub-agent-1');
  });

  it('mergeAgentSessionInfo keeps base requestId when extra omits it', () => {
    const merged = mergeAgentSessionInfo(
      { requestId: 'bidi-session-1', dataPreview: 'abc' },
      { requestedModelId: 'composer-2.5', requestId: undefined }
    );

    assert.equal(merged?.requestId, 'bidi-session-1');
    assert.equal(merged?.requestedModelId, 'composer-2.5');
    assert.equal(merged?.dataPreview, 'abc');
  });

  it('mergeAgentSessionInfo preserves every populated field when extra has undefined keys', () => {
    const base = {
      requestId: 'bidi-1',
      conversationId: 'conv-1',
      conversationGroupId: 'group-1',
      parentRequestId: 'parent-1',
      subagentRequestId: 'sub-1',
      appendSeqno: 2,
      pollSeqno: 5,
      dataPreview: 'preview',
      dataBytes: 99,
      streamingTokens: 120,
      requestedModelId: 'composer-2.5',
      modelName: 'composer-2.5',
      usageEvent: 'token_delta' as const,
    };
    const merged = mergeAgentSessionInfo(base, {
      requestId: undefined,
      conversationId: undefined,
      conversationGroupId: undefined,
      parentRequestId: undefined,
      subagentRequestId: undefined,
      appendSeqno: undefined,
      pollSeqno: undefined,
      dataPreview: undefined,
      dataBytes: undefined,
      streamingTokens: undefined,
      modelDisplayName: 'Composer 2.5',
    });

    assert.deepEqual(merged, {
      ...base,
      modelDisplayName: 'Composer 2.5',
    });
  });

  it('definedAgentFields omits undefined keys from extractor output', () => {
    assert.deepEqual(
      definedAgentFields({
        requestId: undefined,
        conversationId: 'conv-1',
        parentRequestId: undefined,
      }),
      { conversationId: 'conv-1' }
    );
  });

  it('extractConversationAndSubagentIds omits undefined relationship fields', () => {
    const ids = extractConversationAndSubagentIds({
      runRequest: {
        conversationId: 'conv-only',
      },
    });

    assert.deepEqual(ids, { conversationId: 'conv-only' });
  });

  it('combines prewarm, subagent-result, and task relationships without overwriting earlier fields', () => {
    const ids = extractConversationAndSubagentIds({
      runRequest: { conversationId: 'run-conversation' },
      prewarmRequest: {
        conversationId: 'prewarm-conversation',
        conversationGroupId: 'prewarm-group',
      },
      subagentResult: { success: { agentId: 'result-subagent' } },
      taskToolCallArgs: {
        parentRequestId: 'task-parent',
        subagentRequestId: 'task-subagent',
      },
    });

    assert.deepEqual(ids, {
      conversationId: 'run-conversation',
      conversationGroupId: 'prewarm-group',
      parentRequestId: 'task-parent',
      subagentRequestId: 'result-subagent',
    });
  });

  it('extracts workspace identifiers from the private workspace shape', () => {
    const insights = extractInsightsForRpc('/agent.v1.AgentService/RunSSE', {
      private_workspace_identifier: { workspaceId: 'private-workspace' },
    });

    assert.equal(insights?.workspace?.workspaceId, 'private-workspace');
  });

  it('extractAgentRunRequestInfo omits undefined requestId key', () => {
    const info = extractAgentRunRequestInfo({
      runRequest: {
        requestedModel: { modelId: 'composer-2.5' },
      },
    });

    assert.equal(info?.requestedModelId, 'composer-2.5');
    assert.equal('requestId' in (info ?? {}), false);
  });

  it('calculates token cost from billed tokens before streaming estimates', () => {
    assert.equal(
      estimateTokenCostUsd(
        {
          inputTokens: 1_000_000,
          outputTokens: 500_000,
          streamingTokens: 9_000_000,
        },
        2
      ),
      3
    );
  });

  it('uses streaming tokens only when billed token fields are absent', () => {
    assert.equal(
      estimateTokenCostUsd({ streamingTokens: 2_000_000 }, 1.5),
      3
    );
    assert.equal(estimateTokenCostUsd({ streamingTokens: 2 }, 0), undefined);
  });
});
