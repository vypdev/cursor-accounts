import type { Proxy } from 'http-mitm-proxy';
import type { ProxyTrafficLogger } from './nullLogger';
import type { ProxyLogEntry } from './types';
import type { ProxyTrafficDiagnosticsCollector } from './proxyTrafficDiagnostics';
import type { ProxyTrafficSummary } from '../domain/types/proxyTraffic';
import { shouldLogMitmClientError } from './mitmClientErrorFilter';
import { isCursorHost } from './utils/proxyRequestMetadata';
import { toTrafficSummary } from './proxyTrafficSummary';

type OnErrorParams = Parameters<Proxy['onError']>[0];
type ErrorContext = NonNullable<Parameters<OnErrorParams>[0]>;

export interface MitmProxyErrorHandlerDependencies {
  requestLogger: ProxyTrafficLogger;
  getDiagnostics: () => ProxyTrafficDiagnosticsCollector | null;
  buildRequestUrl: (ctx: ErrorContext) => string;
  onProxyError: (summary: ProxyTrafficSummary) => void;
  emitError: (error: Error) => void;
}

/**
 * Normalizes and publishes MITM errors at the infrastructure boundary.
 * No transport error is exposed to callers before it has passed the noise
 * filter and been converted into the redacted proxy error contract.
 */
export function createMitmProxyErrorHandler(
  dependencies: MitmProxyErrorHandlerDependencies
): OnErrorParams {
  return (ctx, err, errorKind) => {
    const host = ctx?.clientToProxyRequest?.headers?.host ?? '';
    const url = ctx ? dependencies.buildRequestUrl(ctx) : '';
    const message = err instanceof Error ? err.message : String(err);
    if (!shouldLogMitmClientError(errorKind, message)) {
      return;
    }

    dependencies.getDiagnostics()?.recordTlsError();
    const errorEntry: ProxyLogEntry = {
      timestamp: new Date().toISOString(),
      direction: 'error',
      url: url || host || 'unknown',
      host: host || 'unknown',
      headers: {},
      errorKind: errorKind ?? 'PROXY_ERROR',
      errorMessage: message,
      isCursorHost: host ? isCursorHost(host) : undefined,
    };
    dependencies.requestLogger.log(errorEntry);
    dependencies.onProxyError(toTrafficSummary(errorEntry));
    dependencies.emitError(err instanceof Error ? err : new Error(message));
  };
}
