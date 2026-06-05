import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProxyTrafficBus } from '../../application/services/proxyTrafficBus';
import type { ProxyTrafficSummary } from '../../application/types/proxyTraffic';

function sample(): ProxyTrafficSummary {
  return {
    timestamp: new Date().toISOString(),
    kind: 'response',
    url: 'https://api2.cursor.sh/x',
    host: 'api2.cursor.sh',
    endpoint: '/x',
  };
}

describe('ProxyTrafficBus', () => {
  it('publishes to subscribers', () => {
    const bus = new ProxyTrafficBus();
    let count = 0;
    bus.subscribe(() => {
      count += 1;
    });
    bus.publish(sample(), 'p1');
    assert.equal(count, 1);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new ProxyTrafficBus();
    let count = 0;
    const unsub = bus.subscribe(() => {
      count += 1;
    });
    unsub();
    bus.publish(sample());
    assert.equal(count, 0);
  });

  it('isolates listener errors', () => {
    const bus = new ProxyTrafficBus();
    let ok = 0;
    bus.subscribe(() => {
      throw new Error('fail');
    });
    bus.subscribe(() => {
      ok += 1;
    });
    bus.publish(sample());
    assert.equal(ok, 1);
  });
});
