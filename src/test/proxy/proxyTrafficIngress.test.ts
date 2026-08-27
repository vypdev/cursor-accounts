import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyStatistics } from '@cursor-accounts/types';
import type { IProxyApiClient } from '../../domain/ports/IProxyApiClient';
import type { ProxyApiEvent } from '../../domain/types/proxyApi';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';
import {
  ProxyTrafficIngress,
  type ProxyTrafficIngressFactories,
  type ProxyTrafficLogTailer,
} from '../../proxy/proxyTrafficIngress';
import type { ProxyApiClientOptions } from '../../proxy/api/proxyApiClient';

class FakeApiClient implements IProxyApiClient {
  private listener?: (event: ProxyApiEvent) => void;
  private connected = false;
  disconnectCount = 0;
  unsubscribeCount = 0;

  async connect(): Promise<void> {
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

class FakeLogTailer implements ProxyTrafficLogTailer {
  running = false;
  startCount = 0;
  stopCount = 0;
  readonly handlers: {
    onTraffic(summary: ProxyTrafficSummary): void;
    onError?(summary: ProxyTrafficSummary): void;
    onLogFileResolved?(filePath: string | null): void;
  };

  constructor(
    handlers: {
      onTraffic(summary: ProxyTrafficSummary): void;
      onError?(summary: ProxyTrafficSummary): void;
      onLogFileResolved?(filePath: string | null): void;
    }
  ) {
    this.handlers = handlers;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    this.running = true;
    this.startCount += 1;
  }

  stop(): void {
    this.running = false;
    this.stopCount += 1;
  }
}

function summary(kind: ProxyTrafficSummary['kind'] = 'response'): ProxyTrafficSummary {
  return {
    timestamp: '2026-08-27T00:00:00.000Z',
    kind,
    url: 'https://api2.cursor.sh/test',
    host: 'api2.cursor.sh',
    endpoint: '/test',
  };
}

function setup() {
  const apiClients: FakeApiClient[] = [];
  const tailers: FakeLogTailer[] = [];
  const apiOptions: ProxyApiClientOptions[] = [];
  const factories: ProxyTrafficIngressFactories = {
    createApiClient: (options) => {
      apiOptions.push(options);
      const client = new FakeApiClient();
      apiClients.push(client);
      return client;
    },
    createLogTailer: (_logDir, handlers) => {
      const tailer = new FakeLogTailer(handlers);
      tailers.push(tailer);
      return tailer;
    },
  };
  const published: Array<{ summary: ProxyTrafficSummary; profileId?: string }> = [];
  const stats: string[] = [];
  const diagnostics: string[] = [];
  const tailerErrors: string[] = [];
  const resolvedFiles: Array<string | null> = [];

  const ingress = new ProxyTrafficIngress(
    '/tmp/logs',
    {
      publish: (event, profileId) => {
        published.push({ summary: event, profileId });
      },
      subscribe: () => () => undefined,
    },
    () => true,
    {
      onLogFileResolved: (filePath) => resolvedFiles.push(filePath),
      onTailerError: (profileId) => tailerErrors.push(profileId),
      onStats: (profileId) => stats.push(profileId),
      onDiagnostics: (profileId, lines) => diagnostics.push(`${profileId}:${lines.join('|')}`),
    },
    factories
  );

  return {
    ingress,
    apiClients,
    tailers,
    apiOptions,
    published,
    stats,
    diagnostics,
    tailerErrors,
    resolvedFiles,
  };
}

describe('ProxyTrafficIngress', () => {
  it('requires an API port for API mode', async () => {
    const setupState = setup();

    await assert.rejects(
      setupState.ingress.start('profile-1', 8080, { api: true, jsonlTail: false }),
      /apiPort is required/
    );
    assert.equal(setupState.apiClients.length, 0);
  });

  it('connects API mode and routes every event type to the right boundary', async () => {
    const setupState = setup();

    await setupState.ingress.start(
      'profile-1',
      8080,
      { api: true, jsonlTail: false },
      { apiPort: 18_080, apiToken: 'secret' }
    );

    assert.deepEqual(setupState.apiOptions, [
      { baseUrl: 'http://127.0.0.1:18080', reconnect: true, apiToken: 'secret' },
    ]);
    assert.equal(setupState.ingress.isRunning('profile-1'), true);
    assert.equal(setupState.ingress.getApiClient('profile-1'), setupState.apiClients[0]);

    const client = setupState.apiClients[0]!;
    client.emit({ type: 'traffic', timestamp: 't', data: summary() });
    client.emit({ type: 'stats', timestamp: 't', data: {} as ProxyStatistics });
    client.emit({
      type: 'diagnostics',
      timestamp: 't',
      data: { lines: ['healthy'] },
    });
    client.emit({
      type: 'diagnostics',
      timestamp: 't',
      data: { lines: [] },
    });
    client.emit({
      type: 'error',
      timestamp: 't',
      data: { kind: 'SOCKET', message: 'closed' },
    });

    assert.equal(setupState.published.length, 2);
    assert.equal(setupState.published[0]?.profileId, 'profile-1');
    assert.deepEqual(setupState.stats, ['profile-1']);
    assert.deepEqual(setupState.diagnostics, ['profile-1:healthy']);
    assert.equal(setupState.published[1]?.summary.errorKind, 'SOCKET');
    assert.equal(setupState.published[1]?.summary.errorMessage, 'closed');

    await setupState.ingress.start(
      'profile-1',
      8080,
      { api: true, jsonlTail: false },
      { apiPort: 18_080 }
    );
    assert.equal(setupState.apiClients.length, 1);

    await setupState.ingress.start(
      'profile-1',
      8080,
      { api: true, jsonlTail: false },
      { apiPort: 18_080, forceRestart: true }
    );
    assert.equal(setupState.apiClients.length, 2);
    assert.equal(client.disconnectCount, 1);
    assert.equal(client.unsubscribeCount, 1);
  });

  it('starts and restarts JSONL tailing and keeps profile ownership isolated', async () => {
    const setupState = setup();

    await setupState.ingress.start(
      'profile-1',
      8080,
      { api: false, jsonlTail: true },
      { tailFromStart: false }
    );

    const tailer = setupState.tailers[0]!;
    assert.equal(tailer.startCount, 1);
    assert.equal(setupState.ingress.isRunning('profile-1'), true);
    assert.equal(setupState.ingress.getActivePort(), 8080);
    tailer.handlers.onTraffic(summary());
    tailer.handlers.onError?.(summary('error'));
    tailer.handlers.onLogFileResolved?.('/tmp/logs/proxy-1.jsonl');

    assert.equal(setupState.published.length, 2);
    assert.deepEqual(setupState.tailerErrors, ['profile-1']);
    assert.deepEqual(setupState.resolvedFiles, ['/tmp/logs/proxy-1.jsonl']);

    await setupState.ingress.start(
      'profile-1',
      8080,
      { api: false, jsonlTail: true },
      { tailFromStart: false }
    );
    assert.equal(setupState.tailers.length, 1);

    await setupState.ingress.start(
      'profile-1',
      8080,
      { api: false, jsonlTail: true },
      { forceRestart: true }
    );
    assert.equal(setupState.tailers.length, 2);
    assert.equal(tailer.stopCount, 1);

    await setupState.ingress.stop('other-profile');
    assert.equal(setupState.tailers[1]?.stopCount, 0);
    assert.equal(setupState.ingress.getActivePort(), 8080);

    setupState.ingress.stop('profile-1');
    assert.equal(setupState.tailers[1]?.stopCount, 1);
    assert.equal(setupState.ingress.isRunning('profile-1'), false);
    assert.equal(setupState.ingress.getActivePort(), null);
  });

  it('stops every API client when all ingress is stopped', async () => {
    const setupState = setup();

    await setupState.ingress.start(
      'profile-1',
      8080,
      { api: true, jsonlTail: false },
      { apiPort: 18_080 }
    );
    await setupState.ingress.start(
      'profile-2',
      8081,
      { api: true, jsonlTail: false },
      { apiPort: 18_081 }
    );

    setupState.ingress.stopAll();

    assert.deepEqual(
      setupState.apiClients.map((client) => client.disconnectCount),
      [1, 1]
    );
    assert.equal(setupState.ingress.isRunning('profile-1'), false);
    assert.equal(setupState.ingress.isRunning('profile-2'), false);
  });
});
