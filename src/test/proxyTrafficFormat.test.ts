import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  abbreviateUserAgent,
  classifyBodyKind,
  formatTrafficLine,
  toTrafficSummary,
} from '../proxy/proxyTrafficFormat';
import type { ProxyLogEntry, ProxyTrafficSummary } from '../proxy/types';

describe('proxyTrafficFormat', () => {
  const baseEntry = (
    overrides: Partial<ProxyLogEntry> = {}
  ): ProxyLogEntry => ({
    timestamp: '2026-06-03T14:53:33.540Z',
    direction: 'request',
    method: 'POST',
    url: 'https://api2.cursor.sh/aiserver.v1.AiService/GetMe',
    host: 'api2.cursor.sh',
    headers: {
      'content-type': 'application/proto',
      'user-agent': 'connect-es/1.6.1',
      authorization: 'Bearer secret',
      'x-request-id': 'abc12345-0000-0000-0000-000000000000',
    },
    body: '',
    isCursorHost: true,
    ...overrides,
  });

  it('abbreviates connect-es user agent', () => {
    assert.equal(abbreviateUserAgent('connect-es/1.6.1'), 'connect-es');
    assert.equal(abbreviateUserAgent('node'), 'node');
  });

  it('builds traffic summary without sensitive headers in output formatting', () => {
    const summary = toTrafficSummary(baseEntry());
    assert.equal(summary.userAgent, 'connect-es');
    assert.equal(summary.bodyKind, 'empty');
    assert.equal(summary.requestId, 'abc12345-0000-0000-0000-000000000000');
    assert.match(summary.endpoint, /GetMe$/);
  });

  it('formats request and response lines with ProxyTraffic tag', () => {
    const requestLine = formatTrafficLine(toTrafficSummary(baseEntry()), '14:53:33');
    assert.match(requestLine, /\[14:53:33\] \[ProxyTraffic\] → POST/);
    assert.match(requestLine, /connect-es/);
    assert.doesNotMatch(requestLine, /Bearer/);

    const responseLine = formatTrafficLine(
      toTrafficSummary(
        baseEntry({
          direction: 'response',
          method: undefined,
          statusCode: 200,
          body: '{"ok":true}',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'connect-es/1.6.1',
          },
        }),
        42
      ),
      '14:53:34'
    );
    assert.match(responseLine, /\[14:53:34\] \[ProxyTraffic\] ← 200/);
    assert.match(responseLine, /42 ms/);
  });

  it('formats error lines', () => {
    const line = formatTrafficLine({
      timestamp: new Date().toISOString(),
      kind: 'error',
      url: 'https://api2.cursor.sh/test',
      host: 'api2.cursor.sh',
      endpoint: '/test',
      errorKind: 'ON_REQUEST_END_ERROR',
      errorMessage: 'socket hang up',
    });
    assert.match(line, /\[ProxyTraffic\]/);
    assert.match(line, /ON_REQUEST_END_ERROR/);
    assert.match(line, /socket hang up/);
  });

  it('formats billing, token, cost, context, and agent hints deterministically', () => {
    const summary: ProxyTrafficSummary = {
      timestamp: '2026-06-03T14:53:33.540Z',
      kind: 'response',
      url: 'https://api2.cursor.sh/agent',
      host: 'api2.cursor.sh',
      endpoint: '/agent',
      bodyKind: 'proto',
      bodyBytes: 128,
      insights: {
        billing: { spendLimit: { currentSpendUsd: 12.5 } },
        agent: {
          inputTokens: 10,
          outputTokens: 5,
          streamingTokens: 2,
          usageEvent: 'turn_ended',
          estimatedCostUsd: 0.75,
          requestId: 'abcdefgh-1234',
        },
        context: { messageCount: 3 },
      },
    };

    const line = formatTrafficLine(summary, '14:53:35');

    assert.match(
      line,
      /\$12\.50, 15 tok \(turn\), ~\$0\.75, 3 msgs, agent=abcdefgh/
    );
  });

  it('classifies body kinds', () => {
    assert.equal(classifyBodyKind('application/json', 10), 'json');
    assert.equal(classifyBodyKind('application/proto', 3), 'proto');
    assert.equal(classifyBodyKind(undefined, 0), 'empty');
  });
});
