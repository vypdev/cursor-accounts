import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ProxyTrafficDiagnosticsCollector,
  formatDiagnosticsSummaryLines,
  parseConnectTunnelHost,
} from '../../proxy/proxyTrafficDiagnostics';

describe('proxyTrafficDiagnostics', () => {
  it('parseConnectTunnelHost reads CONNECT target', () => {
    assert.equal(
      parseConnectTunnelHost('CONNECT', 'api2.cursor.sh:443', ''),
      'api2.cursor.sh:443'
    );
    assert.equal(parseConnectTunnelHost('GET', '/x', 'api2.cursor.sh'), null);
    assert.equal(
      parseConnectTunnelHost('connect', '/', 'api5.cursor.sh:443'),
      'api5.cursor.sh:443'
    );
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

  it('tracks every agent signal and keeps snapshots defensive', () => {
    const c = new ProxyTrafficDiagnosticsCollector();
    c.recordConnect('https://api5.cursor.sh:443/path');

    const records = [
      ['BidiAppend', 'request', 'HTTP/2'],
      ['BidiAppend', 'response', 'HTTP/2'],
      ['RunPoll', 'request', 'HTTP/1.1'],
      ['RunPoll', 'response', 'HTTP/1.1'],
      ['StreamBidiSSE', 'request', 'HTTP/2'],
      ['StreamBidiSSE', 'response', 'HTTP/2'],
      ['RunSSE', 'request', 'HTTP/2'],
      ['RunSSE', 'response', 'HTTP/2'],
    ] as const;

    for (const [rpc, direction, protocolVersion] of records) {
      c.recordRequest({
        url: `https://agent.api5.cursor.sh/agent.v1.AgentService/${rpc}`,
        host: 'AGENT.API5.CURSOR.SH:443',
        direction,
        protocolVersion,
      });
    }
    c.recordLiveTokenUpdate();

    const snapshot = c.getSnapshot();
    assert.deepEqual(snapshot.agentSignals, {
      bidiAppendRequests: 1,
      bidiAppendResponses: 1,
      runSseRequests: 1,
      runSseResponses: 1,
      streamBidiSseRequests: 1,
      streamBidiSseResponses: 1,
      runPollRequests: 1,
      runPollResponses: 1,
      liveTokenUpdates: 1,
    });
    assert.equal(snapshot.connectHosts['api5.cursor.sh'], 1);
    assert.equal(snapshot.requestHosts['agent.api5.cursor.sh'], 8);
    assert.equal(snapshot.protocolByHost['agent.api5.cursor.sh']?.['HTTP/2'], 6);
    assert.equal(snapshot.protocolByHost['agent.api5.cursor.sh']?.['HTTP/1.1'], 2);
    assert.equal(snapshot.bypassHints.length, 0);
    assert.ok(snapshot.lastAgentSignalAt);

    snapshot.agentSignals.bidiAppendRequests = 99;
    snapshot.requestHosts['agent.api5.cursor.sh'] = 99;
    snapshot.protocolByHost['agent.api5.cursor.sh']!['HTTP/2'] = 99;
    const nextSnapshot = c.getSnapshot();
    assert.equal(nextSnapshot.agentSignals.bidiAppendRequests, 1);
    assert.equal(nextSnapshot.requestHosts['agent.api5.cursor.sh'], 8);
    assert.equal(
      nextSnapshot.protocolByHost['agent.api5.cursor.sh']?.['HTTP/2'],
      6
    );
  });

  it('emits the positive stream diagnostic when agent traffic is complete', () => {
    const c = new ProxyTrafficDiagnosticsCollector();
    c.recordRequest({
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/BidiAppend',
      host: 'agent.api5.cursor.sh',
      direction: 'request',
    });
    c.recordRequest({
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      host: 'agent.api5.cursor.sh',
      direction: 'request',
    });
    c.recordRequest({
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      host: 'agent.api5.cursor.sh',
      direction: 'response',
    });

    const lines = formatDiagnosticsSummaryLines(c.getSnapshot());
    assert.ok(
      lines.some((line) => line.includes('Agent stream appears on MITM')),
      lines.join('\n')
    );
    assert.ok(lines.at(-1)?.includes('will not appear here'));
  });

  it('reports high-volume non-agent traffic and repeated TLS errors', () => {
    const c = new ProxyTrafficDiagnosticsCollector();
    for (let i = 0; i < 6; i += 1) {
      c.recordRequest({
        url: `https://telemetry.cursor.sh/events/${i}`,
        host: 'telemetry.cursor.sh',
        direction: 'request',
      });
    }
    c.recordTlsError();
    c.recordTlsError();
    c.recordTlsError();

    const snapshot = c.getSnapshot();
    assert.ok(
      snapshot.bypassHints.some((h) => h.includes('Background api2 traffic'))
    );
    assert.ok(
      snapshot.bypassHints.some((h) => h.includes('Repeated TLS/client errors'))
    );
    assert.ok(
      c.formatSummaryLines(snapshot).some((line) =>
        line.includes('TLS/client errors logged: 3')
      )
    );
  });

  it('does not suggest bypass when RunPoll is the observed agent transport', () => {
    const c = new ProxyTrafficDiagnosticsCollector();
    c.recordRequest({
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunPoll',
      host: 'agent.api5.cursor.sh',
      direction: 'request',
    });

    assert.deepEqual(c.getSnapshot().bypassHints, []);
  });
});
