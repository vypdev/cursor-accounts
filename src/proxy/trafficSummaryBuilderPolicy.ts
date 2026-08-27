import type { ProxyLogEntry } from '../domain/types/proxyLog';
import type { ProxyTrafficSummary } from '../domain/types/proxyTraffic';

export interface BuildTrafficSummaryOptions {
  decode?: boolean;
  logDir?: string;
  bidiRequestId?: string;
  httpRequestId?: string;
}

/**
 * Decide whether a log entry can contain a body that the proxy decoder should
 * inspect. This policy deliberately excludes error records and disabled
 * decoding so the builder can keep transport orchestration small.
 */
export function shouldDecodeTrafficEntry(
  entry: ProxyLogEntry,
  rpcPathFromUrl: string | null,
  options?: BuildTrafficSummaryOptions
): boolean {
  if (options?.decode === false) {
    return false;
  }
  if (entry.direction === 'error') {
    return false;
  }
  if (!hasBodyData(entry)) {
    return false;
  }
  return entry.isConnectRpc === true || rpcPathFromUrl !== null;
}

/**
 * Add correlation identifiers without mutating the decoded summary. This
 * keeps the builder's output safe to share with multiple consumers.
 */
export function withTrafficSummaryCorrelation(
  summary: ProxyTrafficSummary,
  options?: BuildTrafficSummaryOptions
): ProxyTrafficSummary {
  if (!options?.httpRequestId && !options?.bidiRequestId) {
    return summary;
  }

  const correlated: ProxyTrafficSummary = {
    ...summary,
    ...(options.httpRequestId
      ? { httpRequestId: options.httpRequestId }
      : {}),
  };
  if (!options.bidiRequestId) {
    return correlated;
  }

  return {
    ...correlated,
    insights: {
      ...correlated.insights,
      agent: {
        ...correlated.insights?.agent,
        requestId: options.bidiRequestId,
      },
    },
  };
}

function hasBodyData(entry: ProxyLogEntry): boolean {
  return Boolean(entry.body ?? entry.bodyBase64 ?? entry.bodyFile);
}
