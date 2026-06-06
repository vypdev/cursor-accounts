import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProxyTrafficBus } from '../../../application/services/proxyTrafficBus';
import type { ProxyTrafficSummary } from '../../../application/types/proxyTraffic';

const mockSummary = {
  timestamp: new Date().toISOString(),
  url: 'https://api2.cursor.sh/test',
} as ProxyTrafficSummary;

describe('ProxyTrafficBus with workspace_path', () => {
  it('propagates workspace_path to listeners', () => {
    const bus = new ProxyTrafficBus();
    let receivedWorkspace: string | undefined;

    bus.subscribe((_summary, _profileId, workspacePath) => {
      receivedWorkspace = workspacePath;
    });

    bus.publish(mockSummary, 'profile-1', '/workspace/test');

    assert.equal(receivedWorkspace, '/workspace/test');
  });

  it('is backward compatible with listeners without workspace', () => {
    const bus = new ProxyTrafficBus();
    let called = false;

    bus.subscribe(() => {
      called = true;
    });

    bus.publish(mockSummary, 'profile-1', '/workspace/test');

    assert.equal(called, true);
  });
});
