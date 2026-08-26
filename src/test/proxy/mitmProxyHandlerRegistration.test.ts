import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Proxy } from 'http-mitm-proxy';
import {
  registerMitmProxyHandlers,
  type MitmProxyHandlerRegistrationDependencies,
} from '../../proxy/mitmProxyHandlerRegistration';

type ProxyErrorHandler = Parameters<Proxy['onError']>[0];
type ProxyRequestHandler = Parameters<Proxy['onRequest']>[0];
type ProxyResponseHandler = Parameters<Proxy['onResponse']>[0];

describe('registerMitmProxyHandlers', () => {
  it('registers error, request, and response adapters in transport order', () => {
    const registrations: string[] = [];
    const proxy = {
      onError(_handler: ProxyErrorHandler): void {
        registrations.push('error');
      },
      onRequest(_handler: ProxyRequestHandler): void {
        registrations.push('request');
      },
      onResponse(_handler: ProxyResponseHandler): void {
        registrations.push('response');
      },
    } as unknown as Proxy;
    const dependencies = {
      error: {} as MitmProxyHandlerRegistrationDependencies['error'],
      request: {} as MitmProxyHandlerRegistrationDependencies['request'],
      response: {} as MitmProxyHandlerRegistrationDependencies['response'],
    };

    registerMitmProxyHandlers(proxy, dependencies);

    assert.deepEqual(registrations, ['error', 'request', 'response']);
  });
});
