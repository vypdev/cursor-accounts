import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractInsightsForRpc } from '../../../proxy/insights/rpcInsights';

describe('rpcInsights', () => {
  it('combines the extractors selected by a streaming composer path', () => {
    const insights = extractInsightsForRpc('/aiserver.v1/StreamComposer', {
      input_tokens: 10,
      output_tokens: 5,
      conversation_id: 'conversation-1',
      conversation_messages: [{ user_context: { files: [{ path: '/a.ts' }] } }],
    });

    assert.equal(insights?.tokens?.totalTokens, 15);
    assert.equal(insights?.context?.conversationId, 'conversation-1');
    assert.deepEqual(insights?.context?.includedFiles, ['/a.ts']);
  });

  it('preserves a usage uuid even when the RPC has no agent payload', () => {
    const insights = extractInsightsForRpc('/aiserver.v1/Usage', {
      usage_uuid: 'usage-123',
    });

    assert.deepEqual(insights?.agent, {
      usageUuid: 'usage-123',
      usageEvent: 'usage_uuid',
    });
  });

  it('returns no insight for an unrelated payload', () => {
    assert.equal(
      extractInsightsForRpc('/aiserver.v1/Health', { status: 'ok' }),
      undefined
    );
  });
});
