import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyLogEntry } from '../domain/types/proxyLog';
import type { ProxyTrafficSummary } from '../domain/types/proxyTraffic';
import {
  shouldDecodeTrafficEntry,
  withTrafficSummaryCorrelation,
} from '../proxy/trafficSummaryBuilderPolicy';
import { buildTrafficSummary } from '../proxy/trafficSummaryBuilder';

function entry(overrides: Partial<ProxyLogEntry> = {}): ProxyLogEntry {
  return {
    timestamp: '2026-08-27T00:00:00.000Z',
    direction: 'response',
    url: 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetMe',
    host: 'api2.cursor.sh',
    headers: {},
    ...overrides,
  };
}

describe('trafficSummaryBuilderPolicy', () => {
  it('decodes only body-bearing request/response entries with RPC evidence', () => {
    const bodyEntry = entry({ body: '{}' });

    assert.equal(shouldDecodeTrafficEntry(bodyEntry, '/rpc'), true);
    assert.equal(shouldDecodeTrafficEntry(bodyEntry, null), false);
    assert.equal(
      shouldDecodeTrafficEntry({ ...bodyEntry, isConnectRpc: true }, null),
      true
    );
    assert.equal(
      shouldDecodeTrafficEntry(bodyEntry, '/rpc', { decode: false }),
      false
    );
    assert.equal(shouldDecodeTrafficEntry(entry(), '/rpc'), false);
    assert.equal(
      shouldDecodeTrafficEntry(
        { ...bodyEntry, direction: 'error' },
        '/rpc'
      ),
      false
    );
  });

  it('adds HTTP and Bidi correlation without mutating the source summary', () => {
    const summary: ProxyTrafficSummary = {
      timestamp: entry().timestamp,
      kind: 'response',
      url: entry().url,
      host: entry().host,
      endpoint: '/get-me',
      insights: { agent: { modelName: 'model-a' } },
    };

    const correlated = withTrafficSummaryCorrelation(summary, {
      httpRequestId: 'http-1',
      bidiRequestId: 'bidi-1',
    });

    assert.equal(summary.httpRequestId, undefined);
    assert.equal(summary.insights?.agent?.requestId, undefined);
    assert.equal(correlated.httpRequestId, 'http-1');
    assert.equal(correlated.insights?.agent?.requestId, 'bidi-1');
    assert.equal(correlated.insights?.agent?.modelName, 'model-a');
    assert.strictEqual(withTrafficSummaryCorrelation(summary), summary);
  });
});

describe('buildTrafficSummary', () => {
  it('builds a plain summary and applies correlation when decoding is disabled', async () => {
    const summary = await buildTrafficSummary(
      entry({ body: '{"ignored":true}' }),
      42,
      {
        decode: false,
        httpRequestId: 'http-1',
        bidiRequestId: 'bidi-1',
      }
    );

    assert.equal(summary.durationMs, 42);
    assert.equal(summary.bodyDecoded, undefined);
    assert.equal(summary.httpRequestId, 'http-1');
    assert.equal(summary.insights?.agent?.requestId, 'bidi-1');
  });

  it('decodes JSON RPC bodies and preserves decoded insights and correlation', async () => {
    const summary = await buildTrafficSummary(
      entry({
        direction: 'request',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: 'decoded-request', access_token: 'secret' }),
      }),
      12,
      { httpRequestId: 'http-2', bidiRequestId: 'bidi-2' }
    );

    assert.equal(summary.rpcPath, '/aiserver.v1.DashboardService/GetMe');
    assert.equal(summary.bodyDecoded?.access_token, '[REDACTED]');
    assert.equal(summary.httpRequestId, 'http-2');
    assert.equal(summary.insights?.agent?.requestId, 'bidi-2');
    assert.equal(summary.durationMs, 12);
    assert.equal(summary.decodeError, undefined);
  });

  it('records decoder errors for Connect-marked entries without a valid RPC URL', async () => {
    const summary = await buildTrafficSummary(
      entry({
        url: 'https://example.com/not-an-rpc',
        isConnectRpc: true,
        body: '{}',
      })
    );

    assert.match(summary.decodeError ?? '', /Not a Connect RPC URL/);
    assert.equal(summary.bodyDecoded, undefined);
  });

  it('does not decode error traffic even when it carries a body', async () => {
    const summary = await buildTrafficSummary(
      entry({
        direction: 'error',
        body: '{}',
        errorKind: 'PROXY_ERROR',
        errorMessage: 'connection failed',
      })
    );

    assert.equal(summary.kind, 'error');
    assert.equal(summary.errorKind, 'PROXY_ERROR');
    assert.equal(summary.decodeError, undefined);
  });
});
