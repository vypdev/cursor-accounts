import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyAgentSignalCounts } from '@cursor-accounts/types';
import {
  computeBypassHints,
} from '../../proxy/proxyTrafficDiagnosticsHints';
import {
  cloneProtocolByHost,
  normalizeHostKey,
} from '../../proxy/proxyTrafficDiagnosticsState';
import {
  createAgentSignalCounts,
  recordAgentSignals,
} from '../../proxy/proxyTrafficDiagnosticsSignals';

describe('proxyTrafficDiagnostics boundaries', () => {
  it('classifies signals without mutating the source counters', () => {
    const current: ProxyAgentSignalCounts = createAgentSignalCounts();
    current.bidiAppendRequests = 2;

    const update = recordAgentSignals(
      current,
      'https://agent.api5.cursor.sh/agent.v1.AgentService/BidiAppend',
      'request'
    );

    assert.equal(update.touched, true);
    assert.equal(update.signals.bidiAppendRequests, 3);
    assert.equal(current.bidiAppendRequests, 2);
  });

  it('returns a single actionable hint when no MITM traffic exists', () => {
    assert.deepEqual(
      computeBypassHints({
        connectHosts: {},
        requestHosts: {},
        agentSignals: createAgentSignalCounts(),
        tlsErrors: 0,
      }),
      [
        'No CONNECT/HTTP traffic on MITM yet — Cursor may not be using this proxy port, or no network activity.',
      ]
    );
  });

  it('normalizes host forms and clones nested protocol counters', () => {
    assert.equal(
      normalizeHostKey('', 'https://API5.CURSOR.SH:443/path'),
      'api5.cursor.sh'
    );
    assert.equal(
      normalizeHostKey('/api2.cursor.sh:443/path', ''),
      'api2.cursor.sh'
    );

    const source = { 'api5.cursor.sh': { 'HTTP/2': 2 } };
    const clone = cloneProtocolByHost(source);
    clone['api5.cursor.sh']!['HTTP/2'] = 9;
    assert.equal(source['api5.cursor.sh']['HTTP/2'], 2);
  });
});
