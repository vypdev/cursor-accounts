import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyStatistics } from '@cursor-accounts/types';
import type { IProxyApiClient } from '../../domain/ports/IProxyApiClient';
import type { ProxyApiEvent } from '../../domain/types/proxyApi';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';
import {
  ProxyApiTrafficIngress,
  type ProxyApiTrafficIngressDependencies,
} from '../../proxy/proxyApiTrafficIngress';

class FakeApiClient implements IProxyApiClient {
  connected = false;
  disconnectCount = 0;
  unsubscribeCount = 0;
  shouldFailConnection = false;
  private listener?: (event: ProxyApiEvent) => void;

  async connect(): Promise<void> {
    if (this.shouldFailConnection) {
      throw new Error('connection failed');
    }
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
    this.disconnectCount += 1;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getStatus() {
    return { running: true, mitmPort: 8080, apiPort: 18_080 };
  }

  async getStats(): Promise<ProxyStatistics> {
    return {} as ProxyStatistics;
  }

  async shutdown(): Promise<void> {}

  onEvent(listener: (event: ProxyApiEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
      this.unsubscribeCount += 1;
    };
  }

  emit(event: ProxyApiEvent): void {
    this.listener?.(event);
  }
}

function summary(): ProxyTrafficSummary {
  return {
    timestamp: '2026-08-27T00:00:00.000Z',
    kind: 'response',
    url: 'https://api2.cursor.sh/test',
    host: 'api2.cursor.sh',
    endpoint: '/test',
  };
}

function setup(options: { failConnection?: boolean } = {}) {
  const clients: FakeApiClient[] = [];
  const published: Array<{ summary: ProxyTrafficSummary; profileId: string }> = [];
  const stats: string[] = [];
  const diagnostics: string[] = [];
  const dependencies: ProxyApiTrafficIngressDependencies = {
    createApiClient: () => {
      const client = new FakeApiClient();
      client.shouldFailConnection = options.failConnection === true;
      clients.push(client);
      return client;
    },
    publishTraffic: (event, profileId) => published.push({ summary: event, profileId }),
    onStats: (profileId) => stats.push(profileId),
    onDiagnostics: (profileId, lines) => diagnostics.push(`${profileId}:${lines.join('|')}`),
  };
  return {
    ingress: new ProxyApiTrafficIngress(dependencies),
    clients,
    published,
    stats,
    diagnostics,
  };
}

describe('ProxyApiTrafficIngress', () => {
  it('routes traffic, stats, diagnostics, and error events', async () => {
    const setupState = setup();
    const ingress = setupState.ingress;
    await ingress.start('profile-1', 18_080, false, 'token');

    const client = setupState.clients[0]!;
    client.emit({
      type: 'traffic',
      timestamp: 't',
      data: { ...summary(), profileId: 'profile-from-event' },
    });
    client.emit({ type: 'stats', timestamp: 't', data: {} as ProxyStatistics });
    client.emit({
      type: 'diagnostics',
      timestamp: 't',
      data: { lines: ['line'] },
    });
    client.emit({
      type: 'diagnostics',
      timestamp: 't',
      data: { lines: [] },
    });
    client.emit({
      type: 'error',
      timestamp: 't',
      data: { message: 'closed' },
    });

    assert.equal(setupState.published[0]?.profileId, 'profile-from-event');
    assert.equal(setupState.published[1]?.summary.errorKind, 'PROXY_ERROR');
    assert.deepEqual(setupState.stats, ['profile-1']);
    assert.deepEqual(setupState.diagnostics, ['profile-1:line']);
  });

  it('reuses connected clients and force-restarts them when requested', async () => {
    const setupState = setup();
    const ingress = setupState.ingress;
    await ingress.start('profile-1', 18_080, false);
    await ingress.start('profile-1', 18_080, false);
    assert.equal(setupState.clients.length, 1);

    await ingress.start('profile-1', 18_081, true);

    assert.equal(setupState.clients.length, 2);
    assert.equal(setupState.clients[0]?.disconnectCount, 1);
    assert.equal(setupState.clients[0]?.unsubscribeCount, 1);
    ingress.stopAll();
    assert.equal(setupState.clients[1]?.disconnectCount, 1);
  });

  it('cleans a client when its initial connection fails', async () => {
    const setupState = setup({ failConnection: true });

    await assert.rejects(
      setupState.ingress.start('profile-1', 18_080, false),
      /connection failed/
    );
    assert.equal(setupState.ingress.isRunning('profile-1'), false);
    assert.equal(setupState.clients[0]?.disconnectCount, 1);
    assert.equal(setupState.clients[0]?.unsubscribeCount, 1);
  });
});
