import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';
import type { TrafficListener } from '../../domain/ports/IProxyTrafficBus';
import { ProxyManagerEventRegistry } from '../../services/proxyManagerEventRegistry';

describe('ProxyManagerEventRegistry', () => {
  it('routes traffic and disposes primary and external subscriptions once', async () => {
    const listeners: TrafficListener[] = [];
    const cleanup: string[] = [];
    const received: string[] = [];
    const summary = {} as ProxyTrafficSummary;
    const registry = new ProxyManagerEventRegistry({
      subscribeTraffic: (listener) => {
        const index = listeners.push(listener) - 1;
        return () => cleanup.push(`unsubscribe-${index}`);
      },
      stopTrafficIngress: () => cleanup.push('stop-ingress'),
    });

    registry.setTrafficHandler(async (_summary, profileId) => {
      received.push(profileId ?? 'none');
    });
    registry.onTraffic((_traffic) => received.push('external'));
    listeners[0]?.(summary, 'profile-a');
    listeners[1]?.(summary, 'profile-a');
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(received, ['profile-a', 'external']);
    registry.dispose();
    registry.dispose();
    registry.onTraffic(() => received.push('after-dispose'));

    assert.deepEqual(cleanup, [
      'unsubscribe-0',
      'unsubscribe-1',
      'stop-ingress',
    ]);
    assert.equal(listeners.length, 2);
  });

  it('isolates status and usage listener failures', () => {
    const registry = new ProxyManagerEventRegistry({
      subscribeTraffic: () => () => {},
      stopTrafficIngress: () => {},
    });
    const events: string[] = [];
    registry.onStatusChange(() => {
      events.push('status-before');
      throw new Error('status failure');
    });
    registry.onStatusChange(() => events.push('status-after'));
    registry.onConversationUsagePersisted(() => {
      events.push('usage-before');
      throw new Error('usage failure');
    });
    registry.onConversationUsagePersisted(() => events.push('usage-after'));

    registry.notifyStatusChange();
    registry.notifyUsagePersisted({
      conversationId: 'conversation-a',
      profileId: 'profile-a',
    });

    assert.deepEqual(events, [
      'status-before',
      'status-after',
      'usage-before',
      'usage-after',
    ]);
  });

  it('rejects configuring the primary traffic handler more than once', () => {
    const registry = new ProxyManagerEventRegistry({
      subscribeTraffic: () => () => {},
      stopTrafficIngress: () => {},
    });
    const handler = async () => {};

    registry.setTrafficHandler(handler);
    assert.throws(() => registry.setTrafficHandler(handler), /already configured/);
  });
});
