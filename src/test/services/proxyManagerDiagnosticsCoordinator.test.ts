import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyTrafficDiagnostics } from '@cursor-accounts/types';
import { ProxyManagerDiagnosticsCoordinator } from '../../services/proxyManagerDiagnosticsCoordinator';

describe('ProxyManagerDiagnosticsCoordinator', () => {
  it('honors disabled output and interval throttling', () => {
    let now = 100_000;
    let enabled = false;
    const output: string[][] = [];
    const coordinator = new ProxyManagerDiagnosticsCoordinator({
      getSettings: () => ({ enabled, intervalMs: 30_000 }),
      outputPresenter: {
        appendDiagnostics: (lines: string[]) => output.push(lines),
      } as never,
      now: () => now,
    });
    const diagnostics = createDiagnostics();

    coordinator.maybeEmit(undefined);
    coordinator.maybeEmit(diagnostics);
    assert.equal(output.length, 0);

    enabled = true;
    coordinator.maybeEmit(diagnostics);
    assert.equal(output.length, 1);
    now += 27_999;
    coordinator.maybeEmit(diagnostics);
    assert.equal(output.length, 1);
    now += 1;
    coordinator.maybeEmit(diagnostics);
    assert.equal(output.length, 2);
    assert.ok(output[0]?.[0]?.includes('[ProxyDiagnostics] Summary'));
  });
});

function createDiagnostics(): ProxyTrafficDiagnostics {
  return {
    startedAt: '2026-08-26T00:00:00.000Z',
    windowSeconds: 30,
    connectHosts: {},
    requestHosts: {},
    rpcPaths: {},
    protocolByHost: {},
    agentSignals: {
      bidiAppendRequests: 0,
      bidiAppendResponses: 0,
      runSseRequests: 0,
      runSseResponses: 0,
      streamBidiSseRequests: 0,
      streamBidiSseResponses: 0,
      runPollRequests: 0,
      runPollResponses: 0,
      liveTokenUpdates: 0,
    },
    tlsErrors: 0,
    bypassHints: [],
  };
}
