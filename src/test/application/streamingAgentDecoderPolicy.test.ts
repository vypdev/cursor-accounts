import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyStreamingAgentMessage,
  createStreamingAgentPolicyState,
} from '../../application/services/streamingAgentDecoderPolicy';

describe('streamingAgentDecoderPolicy', () => {
  it('tracks decoded messages and relationship identifiers without emitting usage', () => {
    const result = applyStreamingAgentMessage(
      createStreamingAgentPolicyState(),
      {
        relationshipIds: { conversationId: 'conversation-1' },
        insight: null,
      }
    );

    assert.deepEqual(result.state, {
      messageCount: 1,
      accumulatedTokens: 0,
      relationshipIds: { conversationId: 'conversation-1' },
    });
    assert.equal(result.liveUpdate, undefined);
    assert.equal(result.turnEndedEvent, undefined);
  });

  it('accumulates token deltas and sequences the merged live insight', () => {
    const first = applyStreamingAgentMessage(
      createStreamingAgentPolicyState(),
      {
        relationshipIds: { conversationId: 'conversation-1' },
        insight: { streamingTokens: 12, usageEvent: 'token_delta' },
      }
    );
    const second = applyStreamingAgentMessage(first.state, {
      relationshipIds: { subagentRequestId: 'subagent-1' },
      insight: { streamingTokens: 8, usageEvent: 'token_delta' },
    });

    assert.equal(first.liveUpdate?.accumulatedTokens, 12);
    assert.equal(first.liveUpdate?.agent.eventSequence, 1);
    assert.equal(second.liveUpdate?.latestDelta, 8);
    assert.equal(second.liveUpdate?.accumulatedTokens, 20);
    assert.deepEqual(second.liveUpdate?.agent, {
      conversationId: 'conversation-1',
      subagentRequestId: 'subagent-1',
      streamingTokens: 20,
      usageEvent: 'token_delta',
      eventSequence: 2,
    });
  });

  it('maps turn-ended usage and resets the live accumulator', () => {
    const state = {
      messageCount: 2,
      accumulatedTokens: 30,
      relationshipIds: { conversationId: 'conversation-1' },
    };
    const result = applyStreamingAgentMessage(state, {
      relationshipIds: {},
      insight: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 10,
        usageEvent: 'turn_ended',
      },
    });

    assert.equal(result.state.accumulatedTokens, 0);
    assert.equal(result.turnEndedEvent?.inputTokens, 100);
    assert.equal(result.turnEndedEvent?.outputTokens, 50);
    assert.equal(result.turnEndedEvent?.cacheReadTokens, 10);
    assert.deepEqual(result.turnEndedEvent?.agent, {
      conversationId: 'conversation-1',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      usageEvent: 'turn_ended',
      eventSequence: 3,
    });
  });

  it('emits token details without changing the live accumulator', () => {
    const result = applyStreamingAgentMessage(
      {
        messageCount: 4,
        accumulatedTokens: 40,
        relationshipIds: {},
      },
      {
        relationshipIds: {},
        insight: {
          streamingTokens: 90,
          contextUsedTokens: 90,
          maxTokens: 200,
          usageEvent: 'token_details',
        },
      }
    );

    assert.equal(result.state.accumulatedTokens, 40);
    assert.equal(result.liveUpdate?.latestDelta, 0);
    assert.equal(result.liveUpdate?.accumulatedTokens, 40);
    assert.equal(result.liveUpdate?.agent.contextUsedTokens, 90);
    assert.equal(result.liveUpdate?.agent.eventSequence, 5);
  });

  it('ignores incomplete or unrelated usage insights', () => {
    const incomplete = applyStreamingAgentMessage(
      createStreamingAgentPolicyState(),
      {
        relationshipIds: {},
        insight: { usageEvent: 'token_delta' },
      }
    );
    const unrelated = applyStreamingAgentMessage(incomplete.state, {
      relationshipIds: {},
      insight: { usageEvent: 'usage_uuid', usageUuid: 'usage-1' },
    });

    assert.equal(incomplete.liveUpdate, undefined);
    assert.equal(unrelated.liveUpdate, undefined);
    assert.equal(unrelated.turnEndedEvent, undefined);
    assert.equal(unrelated.state.messageCount, 2);
  });

  it('does not mutate the input state or relationship fields', () => {
    const state = {
      messageCount: 1,
      accumulatedTokens: 5,
      relationshipIds: { conversationId: 'conversation-1' },
    };

    applyStreamingAgentMessage(state, {
      relationshipIds: { conversationGroupId: 'group-1' },
      insight: { streamingTokens: 2, usageEvent: 'token_delta' },
    });

    assert.deepEqual(state, {
      messageCount: 1,
      accumulatedTokens: 5,
      relationshipIds: { conversationId: 'conversation-1' },
    });
  });
});
