import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractUserIdFromJwt,
  isAgentMetricsTraffic,
  resolveProfileIdFromAuthorizationHeader,
} from '../../proxy/jwtProfileResolver';

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
    'base64url'
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

describe('jwtProfileResolver', () => {
  it('extractUserIdFromJwt handles auth0 pipe format', () => {
    const token = buildJwt({ sub: 'auth0|user-abc-123' });
    assert.equal(extractUserIdFromJwt(token), 'user-abc-123');
  });

  it('resolveProfileIdFromAuthorizationHeader maps bearer token to profile', () => {
    const token = buildJwt({ sub: 'auth0|mapped-user' });
    const mapping = new Map([['mapped-user', 'profile-a']]);
    const profileId = resolveProfileIdFromAuthorizationHeader(
      { authorization: `Bearer ${token}` },
      mapping
    );
    assert.equal(profileId, 'profile-a');
  });

  it('isAgentMetricsTraffic requires agent requestId and metrics', () => {
    assert.equal(
      isAgentMetricsTraffic({
        insights: { agent: { requestId: 'req-1' } },
      }),
      false
    );
    assert.equal(
      isAgentMetricsTraffic({
        insights: { agent: { requestId: 'req-1', inputTokens: 10 } },
      }),
      true
    );
    assert.equal(
      isAgentMetricsTraffic({
        isLiveTokenUpdate: true,
        insights: { agent: { requestId: 'req-1' } },
      }),
      true
    );
  });
});
