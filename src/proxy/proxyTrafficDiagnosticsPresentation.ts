import type { ProxyTrafficDiagnostics } from '@cursor-accounts/types';

export const PROXY_DIAGNOSTICS_TAG = '[ProxyDiagnostics]';

export function formatDiagnosticsSummaryLines(
  snapshot: ProxyTrafficDiagnostics
): string[] {
  const lines: string[] = [
    `${PROXY_DIAGNOSTICS_TAG} Summary (${snapshot.windowSeconds}s window, since ${snapshot.startedAt})`,
    `${PROXY_DIAGNOSTICS_TAG} CONNECT tunnels: ${formatTopCounts(snapshot.connectHosts, 8) || '(none)'}`,
    `${PROXY_DIAGNOSTICS_TAG} HTTP hosts: ${formatTopCounts(snapshot.requestHosts, 10) || '(none)'}`,
    `${PROXY_DIAGNOSTICS_TAG} Top RPC paths: ${formatTopCounts(snapshot.rpcPaths, 12) || '(none)'}`,
    `${PROXY_DIAGNOSTICS_TAG} Agent signals: BidiAppend req=${snapshot.agentSignals.bidiAppendRequests} res=${snapshot.agentSignals.bidiAppendResponses} | RunSSE req=${snapshot.agentSignals.runSseRequests} res=${snapshot.agentSignals.runSseResponses} | StreamBidiSSE req=${snapshot.agentSignals.streamBidiSseRequests} res=${snapshot.agentSignals.streamBidiSseResponses} | RunPoll req=${snapshot.agentSignals.runPollRequests} res=${snapshot.agentSignals.runPollResponses} | liveToken=${snapshot.agentSignals.liveTokenUpdates}`,
    `${PROXY_DIAGNOSTICS_TAG} Protocol by host: ${formatProtocolByHost(snapshot.protocolByHost) || '(none)'}`,
  ];

  appendOptionalDiagnostics(lines, snapshot);
  lines.push(
    `${PROXY_DIAGNOSTICS_TAG} Note: traffic that never uses --proxy-server/HTTPS_PROXY will not appear here.`
  );
  return lines;
}

export function parseConnectTunnelHost(
  method: string | undefined,
  url: string,
  hostHeader: string
): string | null {
  if (method?.toUpperCase() !== 'CONNECT') {
    return null;
  }
  const target = url && url !== '/' ? url : hostHeader;
  return target?.split('/')[0]?.trim() || null;
}

function appendOptionalDiagnostics(
  lines: string[],
  snapshot: ProxyTrafficDiagnostics
): void {
  if (snapshot.tlsErrors > 0) {
    lines.push(
      `${PROXY_DIAGNOSTICS_TAG} TLS/client errors logged: ${snapshot.tlsErrors} (untrusted CA or broken stream?)`
    );
  }

  if (snapshot.lastAgentSignalAt) {
    lines.push(
      `${PROXY_DIAGNOSTICS_TAG} Last agent-related RPC: ${snapshot.lastAgentSignalAt}`
    );
  }

  if (snapshot.bypassHints.length > 0) {
    lines.push(`${PROXY_DIAGNOSTICS_TAG} Bypass hints:`);
    for (const hint of snapshot.bypassHints) {
      lines.push(`${PROXY_DIAGNOSTICS_TAG}   • ${hint}`);
    }
  } else if (
    snapshot.agentSignals.bidiAppendRequests > 0 &&
    snapshot.agentSignals.runSseResponses > 0
  ) {
    lines.push(
      `${PROXY_DIAGNOSTICS_TAG} Agent stream appears on MITM (BidiAppend + RunSSE/StreamBidiSSE response).`
    );
  }
}

function formatTopCounts(
  counts: Record<string, number>,
  limit: number
): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return '';
  }
  return entries
    .slice(0, limit)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

function formatProtocolByHost(
  protocolByHost: Record<string, Record<string, number>>
): string {
  const parts: string[] = [];
  for (const [host, protocols] of Object.entries(protocolByHost).sort()) {
    const inner = Object.entries(protocols)
      .map(([protocol, count]) => `${protocol}:${count}`)
      .join(',');
    parts.push(`${host}{${inner}}`);
  }
  return parts.join(' | ');
}
