import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAgentIncrementalStreamUrl } from '../../proxy/agentStreamUrls';

describe('agentStreamUrls', () => {
  it('matches agent streaming RPC paths', () => {
    assert.equal(
      isAgentIncrementalStreamUrl(
        'https://api2.cursor.sh/agent.v1.AgentService/RunSSE'
      ),
      true
    );
    assert.equal(
      isAgentIncrementalStreamUrl(
        'https://api2.cursor.sh/aiserver.v1.HealthService/StreamBidiSSE'
      ),
      true
    );
    assert.equal(
      isAgentIncrementalStreamUrl(
        'https://api2.cursor.sh/aiserver.v1.BidiService/BidiAppend'
      ),
      false
    );
  });
});
