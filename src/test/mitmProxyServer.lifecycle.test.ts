import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Proxy } from 'http-mitm-proxy';
import type { IMitmCertificateDirectory } from '../domain/ports/IMitmCertificateDirectory';
import { MitmProxyServer } from '../proxy/mitmProxyServer';
import { NullLogger, type ProxyTrafficLogger } from '../proxy/nullLogger';
import type { MitmListenOptions, ProxyServerConfig } from '../proxy/types';

type ProxyErrorHandler = Parameters<Proxy['onError']>[0];
type ProxyRequestHandler = Parameters<Proxy['onRequest']>[0];
type ProxyResponseHandler = Parameters<Proxy['onResponse']>[0];

function config(): ProxyServerConfig {
  return {
    port: 8080,
    apiPort: 18080,
    profileId: 'profile-a',
    storageDir: '/tmp/proxy',
    logDir: '/tmp/proxy/logs',
    maxLogSizeMb: 50,
    maxBodyLogBytes: 1024,
    spillLargeBodies: false,
    developmentMode: false,
    trafficDiagnostics: false,
    diagnosticsIntervalMs: 30_000,
  };
}

interface FakeProxyState {
  listenCalls: number;
  closeCalls: number;
}

function createFakeProxy(
  listenResults: Array<Error | undefined>,
  delayMs = 0
): { proxy: Proxy; state: FakeProxyState } {
  const state: FakeProxyState = { listenCalls: 0, closeCalls: 0 };
  const proxy = {
    onError(_handler: ProxyErrorHandler): void {},
    onRequest(_handler: ProxyRequestHandler): void {},
    onResponse(_handler: ProxyResponseHandler): void {},
    listen(
      _options: MitmListenOptions,
      callback?: (error?: Error) => void
    ): void {
      state.listenCalls += 1;
      const result = listenResults.shift();
      const complete = (): void => callback?.(result);
      if (delayMs > 0) {
        setTimeout(complete, delayMs);
      } else {
        complete();
      }
    },
    close(callback?: () => void): void {
      state.closeCalls += 1;
      callback?.();
    },
  } as unknown as Proxy;
  return { proxy, state };
}

function createLogger(): {
  logger: ProxyTrafficLogger;
  initialized: number;
  closed: number;
} {
  const state = { initialized: 0, closed: 0 };
  const logger = new NullLogger() as ProxyTrafficLogger;
  logger.initialize = async () => {
    state.initialized += 1;
  };
  logger.close = async () => {
    state.closed += 1;
  };
  return {
    logger,
    get initialized() {
      return state.initialized;
    },
    get closed() {
      return state.closed;
    },
  };
}

function createCertificateDirectory(): IMitmCertificateDirectory {
  return {
    ensureCaDirectoryForMitm: async () => '/tmp/ca',
  };
}

class TestableMitmProxyServer extends MitmProxyServer {
  constructor(
    private readonly fakeProxy: Proxy,
    certificateDirectory: IMitmCertificateDirectory,
    requestLogger: ProxyTrafficLogger
  ) {
    super(certificateDirectory, requestLogger);
  }

  protected createMitmProxy(): Proxy {
    return this.fakeProxy;
  }
}

describe('MitmProxyServer lifecycle', () => {
  it('shares concurrent startup and lets stop await the in-flight start', async () => {
    const fake = createFakeProxy([undefined], 10);
    const logger = createLogger();
    const server = new TestableMitmProxyServer(
      fake.proxy,
      createCertificateDirectory(),
      logger.logger
    );

    const firstStart = server.start(config());
    const secondStart = server.start(config());
    const stop = server.stop();

    await Promise.all([firstStart, secondStart, stop]);

    assert.equal(fake.state.listenCalls, 1);
    assert.equal(fake.state.closeCalls, 1);
    assert.equal(logger.initialized, 1);
    assert.equal(logger.closed, 1);
  });

  it('cleans up a failed listener start and permits a later retry', async () => {
    const fake = createFakeProxy([new Error('listen failed'), undefined]);
    const logger = createLogger();
    const server = new TestableMitmProxyServer(
      fake.proxy,
      createCertificateDirectory(),
      logger.logger
    );

    await assert.rejects(server.start(config()), /listen failed/);

    assert.equal(fake.state.listenCalls, 1);
    assert.equal(fake.state.closeCalls, 1);
    assert.equal(logger.initialized, 1);
    assert.equal(logger.closed, 1);

    await server.start(config());
    await server.stop();

    assert.equal(fake.state.listenCalls, 2);
    assert.equal(fake.state.closeCalls, 2);
    assert.equal(logger.initialized, 2);
    assert.equal(logger.closed, 2);
  });
});
