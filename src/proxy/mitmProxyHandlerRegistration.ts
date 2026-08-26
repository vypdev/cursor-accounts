import type { Proxy } from 'http-mitm-proxy';
import {
  createMitmProxyErrorHandler,
  type MitmProxyErrorHandlerDependencies,
} from './mitmProxyErrorHandler';
import {
  createMitmProxyRequestHandler,
  type MitmProxyRequestHandlerDependencies,
} from './mitmProxyRequestHandler';
import {
  createMitmProxyResponseHandler,
  type MitmProxyResponseHandlerDependencies,
} from './mitmProxyResponseHandler';

/** Dependencies used to compose all MITM transport callbacks. */
export interface MitmProxyHandlerRegistrationDependencies {
  error: MitmProxyErrorHandlerDependencies;
  request: MitmProxyRequestHandlerDependencies;
  response: MitmProxyResponseHandlerDependencies;
}

/** Registers the transport adapters without exposing their wiring to callers. */
export function registerMitmProxyHandlers(
  proxy: Proxy,
  dependencies: MitmProxyHandlerRegistrationDependencies
): void {
  proxy.onError(createMitmProxyErrorHandler(dependencies.error));
  proxy.onRequest(createMitmProxyRequestHandler(dependencies.request));
  proxy.onResponse(createMitmProxyResponseHandler(dependencies.response));
}
