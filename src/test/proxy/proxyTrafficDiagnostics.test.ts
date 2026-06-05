import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ProxyTrafficDiagnosticsCollector,
  parseConnectTunnelHost,
} from '../../proxy/proxyTrafficDiagnostics';

describe('proxyTrafficDiagnostics', () => {
  it('parseConnectTunnelHost reads CONNECT target', () => {
    assert.equal(
      parseConnectTunnelHost('CONNECT', 'api2.cursor.sh:443', ''),
      'api2.cursor.sh:443'
    );
    assert.equal(parseConnectTunnelHost('GET', '/x', 'api2.cursor.sh'), null);
  });

  it('counts agent RPCs and emits bypass hint when only background api2', () => {
    const c = new ProxyTrafficDiagnosticsCollector();
    c.recordConnect('api2.cursor.sh:443');
    c.recordRequest({
      url: 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
      host: 'api2.cursor.sh',
      direction: 'request',
      protocolVersion: 'HTTP/1.1',
    });
    c.recordRequest({
      url: 'https://api2.cursor.sh/aiserver.v1.OnlineMetricsService/ReportAgentSnapshot',
      host: 'api2.cursor.sh',
      direction: 'response',
    });

    const snap = c.getSnapshot();
    assert.equal(snap.agentSignals.bidiAppendRequests, 0);
    assert.ok((snap.requestHosts['api2.cursor.sh'] ?? 0) >= 1);
    assert.ok(
      snap.bypassHints.some((h) => h.includes('Background api2 traffic')),
      snap.bypassHints.join(' | ')
    );
  });

  it('detects open RunSSE without response', () => {
    const c = new ProxyTrafficDiagnosticsCollector();
    c.recordRequest({
      url: 'https://api2.cursor.sh/agent.v1.AgentService/RunSSE',
      host: 'api2.cursor.sh',
      direction: 'request',
    });
    const snap = c.getSnapshot();
    assert.equal(snap.agentSignals.runSseRequests, 1);
    assert.equal(snap.agentSignals.runSseResponses, 0);
    assert.ok(
      snap.bypassHints.some((h) => h.includes('without completed MITM response'))
    );
  });
});
