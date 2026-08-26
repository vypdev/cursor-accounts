import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyLogEntry } from '../../proxy/types';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';
import { NullLogger, type ProxyTrafficLogger } from '../../proxy/nullLogger';
import { ProxyTrafficDiagnosticsCollector } from '../../proxy/proxyTrafficDiagnostics';
import {
  createMitmProxyErrorHandler,
  type MitmProxyErrorHandlerDependencies,
} from '../../proxy/mitmProxyErrorHandler';

type ErrorHandler = ReturnType<typeof createMitmProxyErrorHandler>;
type ErrorContext = NonNullable<Parameters<ErrorHandler>[0]>;

function createDependencies(): {
  loggedEntries: ProxyLogEntry[];
  summaries: ProxyTrafficSummary[];
  emittedErrors: Error[];
  diagnostics: ProxyTrafficDiagnosticsCollector;
  dependencies: MitmProxyErrorHandlerDependencies;
} {
  const loggedEntries: ProxyLogEntry[] = [];
  const summaries: ProxyTrafficSummary[] = [];
  const emittedErrors: Error[] = [];
  const diagnostics = new ProxyTrafficDiagnosticsCollector();
  const logger = new NullLogger() as ProxyTrafficLogger;
  logger.log = (entry) => {
    loggedEntries.push(entry);
  };

  return {
    loggedEntries,
    summaries,
    emittedErrors,
    diagnostics,
    dependencies: {
      requestLogger: logger,
      getDiagnostics: () => diagnostics,
      buildRequestUrl: () => 'https://api2.cursor.sh/error',
      onProxyError: (summary) => summaries.push(summary),
      emitError: (error) => emittedErrors.push(error),
    },
  };
}

function createContext(): ErrorContext {
  return {
    clientToProxyRequest: {
      headers: { host: 'api2.cursor.sh' },
      method: 'GET',
      url: '/error',
    },
  } as ErrorContext;
}

describe('MitmProxyErrorHandler', () => {
  it('logs, diagnoses, summarizes, and emits a contextual proxy error', () => {
    const state = createDependencies();
    const handler = createMitmProxyErrorHandler(state.dependencies);

    handler(createContext(), new Error('upstream failed'), 'PROXY_ERROR');

    assert.equal(state.loggedEntries.length, 1);
    assert.equal(state.loggedEntries[0]?.direction, 'error');
    assert.equal(state.loggedEntries[0]?.host, 'api2.cursor.sh');
    assert.equal(state.loggedEntries[0]?.url, 'https://api2.cursor.sh/error');
    assert.equal(state.summaries[0]?.errorKind, 'PROXY_ERROR');
    assert.equal(state.summaries[0]?.errorMessage, 'upstream failed');
    assert.equal(state.emittedErrors[0]?.message, 'upstream failed');
    assert.equal(state.diagnostics.getSnapshot().tlsErrors, 1);
  });

  it('uses a safe unknown target when the proxy context is absent', () => {
    const state = createDependencies();
    const handler = createMitmProxyErrorHandler(state.dependencies);

    handler(null, new Error('connection failed'), 'PROXY_ERROR');

    assert.equal(state.loggedEntries[0]?.host, 'unknown');
    assert.equal(state.loggedEntries[0]?.url, 'unknown');
    assert.equal(state.summaries[0]?.endpoint, 'unknown');
    assert.equal(state.emittedErrors[0]?.message, 'connection failed');
  });

  it('suppresses known client-side MITM noise before side effects', () => {
    const state = createDependencies();
    const handler = createMitmProxyErrorHandler(state.dependencies);

    handler(
      createContext(),
      new Error('SSLV3_ALERT_CERTIFICATE_UNKNOWN'),
      'HTTPS_CLIENT_ERROR'
    );

    assert.deepEqual(state.loggedEntries, []);
    assert.deepEqual(state.summaries, []);
    assert.deepEqual(state.emittedErrors, []);
    assert.equal(state.diagnostics.getSnapshot().tlsErrors, 0);
  });
});
