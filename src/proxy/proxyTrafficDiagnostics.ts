import type { HttpProtocolVersion } from '../domain/types/httpProtocol';
import { parseRpcPath } from './proxyDecode';
import { isAgentIncrementalStreamUrl } from './agentStreamUrls';

export const PROXY_DIAGNOSTICS_TAG = '[ProxyDiagnostics]';

export interface ProxyAgentSignalCounts {
  bidiAppendRequests: number;
  bidiAppendResponses: number;
  runSseRequests: number;
  runSseResponses: number;
  streamBidiSseRequests: number;
  streamBidiSseResponses: number;
  runPollRequests: number;
  runPollResponses: number;
  liveTokenUpdates: number;
}

export interface ProxyTrafficDiagnostics {
  startedAt: string;
  windowSeconds: number;
  connectHosts: Record<string, number>;
  requestHosts: Record<string, number>;
  rpcPaths: Record<string, number>;
  protocolByHost: Record<string, Record<string, number>>;
  agentSignals: ProxyAgentSignalCounts;
  tlsErrors: number;
  bypassHints: string[];
  lastAgentSignalAt?: string;
}

export interface RecordProxyRequestInput {
  method?: string;
  url: string;
  host: string;
  direction: 'request' | 'response';
  protocolVersion?: HttpProtocolVersion;
}

/**
 * Aggregates MITM-visible traffic to surface likely proxy bypass (traffic that
 * never hits localhost:port won't appear here).
 */
export class ProxyTrafficDiagnosticsCollector {
  private readonly startedAt = Date.now();
  private readonly connectHosts: Record<string, number> = {};
  private readonly requestHosts: Record<string, number> = {};
  private readonly rpcPaths: Record<string, number> = {};
  private readonly protocolByHost: Record<string, Record<string, number>> = {};
  private tlsErrors = 0;
  private lastAgentSignalAt: number | undefined;
  readonly agentSignals: ProxyAgentSignalCounts = {
    bidiAppendRequests: 0,
    bidiAppendResponses: 0,
    runSseRequests: 0,
    runSseResponses: 0,
    streamBidiSseRequests: 0,
    streamBidiSseResponses: 0,
    runPollRequests: 0,
    runPollResponses: 0,
    liveTokenUpdates: 0,
  };

  recordTlsError(): void {
    this.tlsErrors += 1;
  }

  recordLiveTokenUpdate(): void {
    this.agentSignals.liveTokenUpdates += 1;
    this.lastAgentSignalAt = Date.now();
  }

  recordRequest(input: RecordProxyRequestInput): void {
    const hostKey = normalizeHostKey(input.host, input.url);
    if (hostKey) {
      this.requestHosts[hostKey] = (this.requestHosts[hostKey] ?? 0) + 1;
      if (input.protocolVersion) {
        const byProto = this.protocolByHost[hostKey] ?? {};
        byProto[input.protocolVersion] = (byProto[input.protocolVersion] ?? 0) + 1;
        this.protocolByHost[hostKey] = byProto;
      }
    }

    const rpcPath = parseRpcPath(input.url);
    if (rpcPath) {
      this.rpcPaths[rpcPath] = (this.rpcPaths[rpcPath] ?? 0) + 1;
    }

    this.recordAgentSignals(input.url, input.direction);
  }

  private recordAgentSignals(
    url: string,
    direction: 'request' | 'response'
  ): void {
    let touched = false;
    const a = this.agentSignals;

    if (url.includes('BidiAppend')) {
      if (direction === 'request') {
        a.bidiAppendRequests += 1;
      } else {
        a.bidiAppendResponses += 1;
      }
      touched = true;
    }

    if (url.includes('RunPoll')) {
      if (direction === 'request') {
        a.runPollRequests += 1;
      } else {
        a.runPollResponses += 1;
      }
      touched = true;
    }

    if (url.includes('StreamBidiSSE')) {
      if (direction === 'request') {
        a.streamBidiSseRequests += 1;
      } else {
        a.streamBidiSseResponses += 1;
      }
      touched = true;
    } else if (isAgentIncrementalStreamUrl(url) && url.includes('RunSSE')) {
      if (direction === 'request') {
        a.runSseRequests += 1;
      } else {
        a.runSseResponses += 1;
      }
      touched = true;
    }

    if (touched) {
      this.lastAgentSignalAt = Date.now();
    }
  }

  recordConnect(connectTarget: string): void {
    const key = normalizeHostKey(connectTarget, connectTarget);
    if (!key) {
      return;
    }
    this.connectHosts[key] = (this.connectHosts[key] ?? 0) + 1;
  }

  getSnapshot(): ProxyTrafficDiagnostics {
    const windowSeconds = Math.max(
      1,
      Math.floor((Date.now() - this.startedAt) / 1000)
    );
    return {
      startedAt: new Date(this.startedAt).toISOString(),
      windowSeconds,
      connectHosts: { ...this.connectHosts },
      requestHosts: { ...this.requestHosts },
      rpcPaths: { ...this.rpcPaths },
      protocolByHost: cloneProtocolByHost(this.protocolByHost),
      agentSignals: { ...this.agentSignals },
      tlsErrors: this.tlsErrors,
      bypassHints: computeBypassHints({
        connectHosts: this.connectHosts,
        requestHosts: this.requestHosts,
        agentSignals: this.agentSignals,
        tlsErrors: this.tlsErrors,
      }),
      lastAgentSignalAt:
        this.lastAgentSignalAt != null
          ? new Date(this.lastAgentSignalAt).toISOString()
          : undefined,
    };
  }

  formatSummaryLines(snapshot?: ProxyTrafficDiagnostics): string[] {
    return formatDiagnosticsSummaryLines(snapshot ?? this.getSnapshot());
  }
}

export function formatDiagnosticsSummaryLines(
  s: ProxyTrafficDiagnostics
): string[] {
  const lines: string[] = [
      `${PROXY_DIAGNOSTICS_TAG} Summary (${s.windowSeconds}s window, since ${s.startedAt})`,
      `${PROXY_DIAGNOSTICS_TAG} CONNECT tunnels: ${formatTopCounts(s.connectHosts, 8) || '(none)'}`,
      `${PROXY_DIAGNOSTICS_TAG} HTTP hosts: ${formatTopCounts(s.requestHosts, 10) || '(none)'}`,
      `${PROXY_DIAGNOSTICS_TAG} Top RPC paths: ${formatTopCounts(s.rpcPaths, 12) || '(none)'}`,
      `${PROXY_DIAGNOSTICS_TAG} Agent signals: BidiAppend req=${s.agentSignals.bidiAppendRequests} res=${s.agentSignals.bidiAppendResponses} | RunSSE req=${s.agentSignals.runSseRequests} res=${s.agentSignals.runSseResponses} | StreamBidiSSE req=${s.agentSignals.streamBidiSseRequests} res=${s.agentSignals.streamBidiSseResponses} | RunPoll req=${s.agentSignals.runPollRequests} res=${s.agentSignals.runPollResponses} | liveToken=${s.agentSignals.liveTokenUpdates}`,
      `${PROXY_DIAGNOSTICS_TAG} Protocol by host: ${formatProtocolByHost(s.protocolByHost) || '(none)'}`,
    ];

  if (s.tlsErrors > 0) {
    lines.push(
      `${PROXY_DIAGNOSTICS_TAG} TLS/client errors logged: ${s.tlsErrors} (untrusted CA or broken stream?)`
    );
  }

  if (s.lastAgentSignalAt) {
    lines.push(
      `${PROXY_DIAGNOSTICS_TAG} Last agent-related RPC: ${s.lastAgentSignalAt}`
    );
  }

  if (s.bypassHints.length > 0) {
    lines.push(`${PROXY_DIAGNOSTICS_TAG} Bypass hints:`);
    for (const hint of s.bypassHints) {
      lines.push(`${PROXY_DIAGNOSTICS_TAG}   • ${hint}`);
    }
  } else if (
    s.agentSignals.bidiAppendRequests > 0 &&
    s.agentSignals.runSseResponses > 0
  ) {
    lines.push(
      `${PROXY_DIAGNOSTICS_TAG} Agent stream appears on MITM (BidiAppend + RunSSE/StreamBidiSSE response).`
    );
  }

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

function computeBypassHints(input: {
  connectHosts: Record<string, number>;
  requestHosts: Record<string, number>;
  agentSignals: ProxyAgentSignalCounts;
  tlsErrors: number;
}): string[] {
  const hints: string[] = [];
  const hosts = Object.keys(input.requestHosts);
  const connectHosts = Object.keys(input.connectHosts);
  const a = input.agentSignals;
  const totalHttp = Object.values(input.requestHosts).reduce(
    (sum, n) => sum + n,
    0
  );

  const hasApi2 =
    hosts.some((h) => h.includes('api2')) ||
    connectHosts.some((h) => h.includes('api2'));
  const hasApi5 =
    hosts.some((h) => h.includes('api5')) ||
    connectHosts.some((h) => h.includes('api5'));

  if (totalHttp === 0 && Object.keys(connectHosts).length === 0) {
    hints.push(
      'No CONNECT/HTTP traffic on MITM yet — Cursor may not be using this proxy port, or no network activity.'
    );
    return hints;
  }

  if (
    (hasApi2 || totalHttp > 5) &&
    a.bidiAppendRequests === 0 &&
    a.runSseRequests === 0 &&
    a.streamBidiSseRequests === 0 &&
    a.runPollRequests === 0
  ) {
    hints.push(
      'Background api2 traffic without BidiAppend/RunSSE/StreamBidiSSE — Agent chat may bypass Chromium proxy (try profile launch with --proxy-server, or CLI with HTTPS_PROXY).'
    );
  }

  if (!hasApi5 && hasApi2 && a.runSseRequests === 0 && a.streamBidiSseRequests === 0) {
    hints.push(
      'No agent.api5 and no RunSSE/StreamBidiSSE on MITM — HTTP/2 Agent host may be going direct while api2 metrics still hit the proxy.'
    );
  }

  if (a.bidiAppendRequests > 0 && a.runSseRequests === 0 && a.streamBidiSseRequests === 0) {
    hints.push(
      'BidiAppend without RunSSE/StreamBidiSSE request — server stream might use RunPoll only or a path not yet seen.'
    );
  }

  if (
    (a.runSseRequests > 0 || a.streamBidiSseRequests > 0) &&
    a.runSseResponses === 0 &&
    a.streamBidiSseResponses === 0
  ) {
    hints.push(
      'Agent stream request(s) without completed MITM response — stream still open, proxy stopped early, or parse/connection error.'
    );
  }

  if (a.runSseRequests > 0 && a.liveTokenUpdates === 0 && a.runSseResponses === 0) {
    hints.push(
      'RunSSE/StreamBidiSSE started but no live token_delta yet — wait for stream chunks or check decode/CA.'
    );
  }

  if (input.tlsErrors >= 3) {
    hints.push(
      'Repeated TLS/client errors — reinstall panel CA and relaunch profile (wrong CA = partial or failed interception).'
    );
  }

  return hints;
}

function normalizeHostKey(host: string, url: string): string {
  const raw = (host || url).trim().toLowerCase();
  if (!raw) {
    return '';
  }
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return new URL(raw).host.toLowerCase();
    }
  } catch {
    // fall through
  }
  return raw.replace(/^\/+/, '').split('/')[0]?.split(':')[0] ?? raw;
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
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

function formatProtocolByHost(
  protocolByHost: Record<string, Record<string, number>>
): string {
  const parts: string[] = [];
  for (const [host, protos] of Object.entries(protocolByHost).sort()) {
    const inner = Object.entries(protos)
      .map(([p, n]) => `${p}:${n}`)
      .join(',');
    parts.push(`${host}{${inner}}`);
  }
  return parts.join(' | ');
}

function cloneProtocolByHost(
  src: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [host, protos] of Object.entries(src)) {
    out[host] = { ...protos };
  }
  return out;
}
