import type { ProxyAgentSignalCounts } from '@cursor-accounts/types';
import { isAgentIncrementalStreamUrl } from './agentStreamUrls';

export interface AgentSignalUpdate {
  signals: ProxyAgentSignalCounts;
  touched: boolean;
}

export function createAgentSignalCounts(): ProxyAgentSignalCounts {
  return {
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
}

/** Classifies one MITM-visible URL without mutating the collector state. */
export function recordAgentSignals(
  current: ProxyAgentSignalCounts,
  url: string,
  direction: 'request' | 'response'
): AgentSignalUpdate {
  const signals = { ...current };
  let touched = false;

  if (url.includes('BidiAppend')) {
    signals[
      direction === 'request' ? 'bidiAppendRequests' : 'bidiAppendResponses'
    ] += 1;
    touched = true;
  }

  if (url.includes('RunPoll')) {
    signals[direction === 'request' ? 'runPollRequests' : 'runPollResponses'] +=
      1;
    touched = true;
  }

  if (url.includes('StreamBidiSSE')) {
    signals[
      direction === 'request'
        ? 'streamBidiSseRequests'
        : 'streamBidiSseResponses'
    ] += 1;
    touched = true;
  } else if (isAgentIncrementalStreamUrl(url) && url.includes('RunSSE')) {
    signals[direction === 'request' ? 'runSseRequests' : 'runSseResponses'] += 1;
    touched = true;
  }

  return { signals, touched };
}

export function computeBypassHints(input: {
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

  const hasApi2 = hasHost(hosts, connectHosts, 'api2');
  const hasApi5 = hasHost(hosts, connectHosts, 'api5');

  if (totalHttp === 0 && connectHosts.length === 0) {
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

export function normalizeHostKey(host: string, url: string): string {
  const raw = (host || url).trim().toLowerCase();
  if (!raw) {
    return '';
  }
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return new URL(raw).host.toLowerCase();
    }
  } catch {
    // Fall through to the proxy's host-oriented normalization.
  }
  return raw.replace(/^\/+/, '').split('/')[0]?.split(':')[0] ?? raw;
}

export function cloneProtocolByHost(
  source: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  const clone: Record<string, Record<string, number>> = {};
  for (const [host, protocols] of Object.entries(source)) {
    clone[host] = { ...protocols };
  }
  return clone;
}

function hasHost(hosts: string[], connectHosts: string[], fragment: string): boolean {
  return (
    hosts.some((host) => host.includes(fragment)) ||
    connectHosts.some((host) => host.includes(fragment))
  );
}
