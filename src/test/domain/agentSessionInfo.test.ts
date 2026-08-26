import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergeAgentSessionFields,
  mergeAgentSessionInfo,
} from '../../domain/services/agentSessionInfo';

describe('agentSessionInfo', () => {
  it('merges populated fields without allowing undefined values to erase state', () => {
    assert.deepEqual(
      mergeAgentSessionFields(
        { conversationId: 'conversation-1', requestId: 'request-1' },
        { conversationId: undefined, subagentRequestId: 'subagent-1' }
      ),
      {
        conversationId: 'conversation-1',
        requestId: 'request-1',
        subagentRequestId: 'subagent-1',
      }
    );
  });

  it('returns undefined when optional merge inputs contain no fields', () => {
    assert.equal(mergeAgentSessionInfo(undefined, undefined), undefined);
    assert.equal(mergeAgentSessionInfo({}, {}), undefined);
  });

  it('returns a populated object when either optional input has fields', () => {
    assert.deepEqual(mergeAgentSessionInfo(undefined, { requestId: 'request-1' }), {
      requestId: 'request-1',
    });
  });
});
