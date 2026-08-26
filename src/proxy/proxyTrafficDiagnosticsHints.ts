import type { ProxyAgentSignalCounts } from '@cursor-accounts/types';

export interface BypassHintInput {
  connectHosts: Record<string, number>;
  requestHosts: Record<string, number>;
  agentSignals: ProxyAgentSignalCounts;
  tlsErrors: number;
}

interface BypassHintContext extends BypassHintInput {
  connectHostKeys: string[];
  requestHostKeys: string[];
  totalHttp: number;
  hasApi2: boolean;
  hasApi5: boolean;
}

const NO_TRAFFIC_HINT =
  'No CONNECT/HTTP traffic on MITM yet — Cursor may not be using this proxy port, or no network activity.';

/** Applies ordered, observable hints to the current MITM traffic window. */
export function computeBypassHints(input: BypassHintInput): string[] {
  const context = createContext(input);
  if (context.totalHttp === 0 && context.connectHostKeys.length === 0) {
    return [NO_TRAFFIC_HINT];
  }

  return [
    backgroundTrafficHint(context),
    missingAgentApi5Hint(context),
    bidiAppendWithoutStreamHint(context),
    incompleteStreamHint(context),
    missingLiveTokenHint(context),
    repeatedTlsHint(context),
  ].filter(isHint);
}

function createContext(input: BypassHintInput): BypassHintContext {
  const requestHostKeys = Object.keys(input.requestHosts);
  const connectHostKeys = Object.keys(input.connectHosts);
  return {
    ...input,
    requestHostKeys,
    connectHostKeys,
    totalHttp: Object.values(input.requestHosts).reduce(
      (sum, count) => sum + count,
      0
    ),
    hasApi2: hasHost(requestHostKeys, connectHostKeys, 'api2'),
    hasApi5: hasHost(requestHostKeys, connectHostKeys, 'api5'),
  };
}

function backgroundTrafficHint(context: BypassHintContext): string | undefined {
  const { agentSignals } = context;
  const noAgentRequests =
    agentSignals.bidiAppendRequests === 0 &&
    agentSignals.runSseRequests === 0 &&
    agentSignals.streamBidiSseRequests === 0 &&
    agentSignals.runPollRequests === 0;
  if (!((context.hasApi2 || context.totalHttp > 5) && noAgentRequests)) {
    return undefined;
  }
  return 'Background api2 traffic without BidiAppend/RunSSE/StreamBidiSSE — Agent chat may bypass Chromium proxy (try profile launch with --proxy-server, or CLI with HTTPS_PROXY).';
}

function missingAgentApi5Hint(context: BypassHintContext): string | undefined {
  const { agentSignals } = context;
  if (
    context.hasApi5 ||
    !context.hasApi2 ||
    agentSignals.runSseRequests > 0 ||
    agentSignals.streamBidiSseRequests > 0
  ) {
    return undefined;
  }
  return 'No agent.api5 and no RunSSE/StreamBidiSSE on MITM — HTTP/2 Agent host may be going direct while api2 metrics still hit the proxy.';
}

function bidiAppendWithoutStreamHint(
  context: BypassHintContext
): string | undefined {
  const { agentSignals } = context;
  if (
    agentSignals.bidiAppendRequests === 0 ||
    agentSignals.runSseRequests > 0 ||
    agentSignals.streamBidiSseRequests > 0
  ) {
    return undefined;
  }
  return 'BidiAppend without RunSSE/StreamBidiSSE request — server stream might use RunPoll only or a path not yet seen.';
}

function incompleteStreamHint(context: BypassHintContext): string | undefined {
  const { agentSignals } = context;
  const hasStreamRequest =
    agentSignals.runSseRequests > 0 || agentSignals.streamBidiSseRequests > 0;
  const hasStreamResponse =
    agentSignals.runSseResponses > 0 ||
    agentSignals.streamBidiSseResponses > 0;
  if (!hasStreamRequest || hasStreamResponse) {
    return undefined;
  }
  return 'Agent stream request(s) without completed MITM response — stream still open, proxy stopped early, or parse/connection error.';
}

function missingLiveTokenHint(context: BypassHintContext): string | undefined {
  const { agentSignals } = context;
  if (
    agentSignals.runSseRequests === 0 ||
    agentSignals.liveTokenUpdates > 0 ||
    agentSignals.runSseResponses > 0
  ) {
    return undefined;
  }
  return 'RunSSE/StreamBidiSSE started but no live token_delta yet — wait for stream chunks or check decode/CA.';
}

function repeatedTlsHint(context: BypassHintContext): string | undefined {
  if (context.tlsErrors < 3) {
    return undefined;
  }
  return 'Repeated TLS/client errors — reinstall panel CA and relaunch profile (wrong CA = partial or failed interception).';
}

function hasHost(
  requestHostKeys: string[],
  connectHostKeys: string[],
  fragment: string
): boolean {
  return (
    requestHostKeys.some((host) => host.includes(fragment)) ||
    connectHostKeys.some((host) => host.includes(fragment))
  );
}

function isHint(value: string | undefined): value is string {
  return value !== undefined;
}
