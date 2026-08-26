import type { ProxyAgentSignalCounts, ProxyTrafficDiagnostics } from '@cursor-accounts/types';
import type { HttpProtocolVersion } from '../domain/types/httpProtocol';
import { parseRpcPath } from './proxyDecode';
import {
  cloneProtocolByHost,
  normalizeHostKey,
} from './proxyTrafficDiagnosticsState';
import { computeBypassHints } from './proxyTrafficDiagnosticsHints';
import {
  createAgentSignalCounts,
  recordAgentSignals,
} from './proxyTrafficDiagnosticsSignals';
import {
  formatDiagnosticsSummaryLines,
} from './proxyTrafficDiagnosticsPresentation';

export type { ProxyAgentSignalCounts, ProxyTrafficDiagnostics } from '@cursor-accounts/types';
export {
  PROXY_DIAGNOSTICS_TAG,
  formatDiagnosticsSummaryLines,
  parseConnectTunnelHost,
} from './proxyTrafficDiagnosticsPresentation';

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
  readonly agentSignals: ProxyAgentSignalCounts = createAgentSignalCounts();

  recordTlsError(): void {
    this.tlsErrors += 1;
  }

  recordLiveTokenUpdate(): void {
    this.agentSignals.liveTokenUpdates += 1;
    this.lastAgentSignalAt = Date.now();
  }

  recordRequest(input: RecordProxyRequestInput): void {
    this.recordHostTraffic(input);

    const rpcPath = parseRpcPath(input.url);
    if (rpcPath) {
      this.rpcPaths[rpcPath] = (this.rpcPaths[rpcPath] ?? 0) + 1;
    }

    const signalUpdate = recordAgentSignals(
      this.agentSignals,
      input.url,
      input.direction
    );
    Object.assign(this.agentSignals, signalUpdate.signals);
    if (signalUpdate.touched) {
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

  private recordHostTraffic(input: RecordProxyRequestInput): void {
    const hostKey = normalizeHostKey(input.host, input.url);
    if (!hostKey) {
      return;
    }

    this.requestHosts[hostKey] = (this.requestHosts[hostKey] ?? 0) + 1;
    if (input.protocolVersion) {
      const byProtocol = this.protocolByHost[hostKey] ?? {};
      byProtocol[input.protocolVersion] =
        (byProtocol[input.protocolVersion] ?? 0) + 1;
      this.protocolByHost[hostKey] = byProtocol;
    }
  }
}
