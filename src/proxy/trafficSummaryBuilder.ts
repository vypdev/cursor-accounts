import { decodeProtoEntry, parseRpcPath } from './proxyDecode';
import { toTrafficSummary } from './proxyTrafficFormat';
import type { ProxyLogEntry, ProxyTrafficSummary } from './types';

export interface BuildTrafficSummaryOptions {
  decode?: boolean;
  logDir?: string;
  bidiRequestId?: string;
  httpRequestId?: string;
}

/**
 * Build a traffic summary, optionally decoding Connect/protobuf bodies.
 */
export async function buildTrafficSummary(
  entry: ProxyLogEntry,
  durationMs?: number,
  options?: BuildTrafficSummaryOptions
): Promise<ProxyTrafficSummary> {
  const rpcPathFromUrl = parseRpcPath(entry.url);
  const shouldDecode =
    options?.decode !== false &&
    (entry.direction === 'request' || entry.direction === 'response') &&
    Boolean(entry.body ?? entry.bodyBase64 ?? entry.bodyFile) &&
    (entry.isConnectRpc === true || rpcPathFromUrl != null);

  if (!shouldDecode) {
    const summary = toTrafficSummary(entry, durationMs);
    applyCorrelation(summary, options);
    return summary;
  }

  const { decoded, insights, rpcPath, error } = await decodeProtoEntry(entry, {
    logDir: options?.logDir,
  });
  const summary = toTrafficSummary(entry, durationMs);

  if (rpcPath) {
    summary.rpcPath = rpcPath;
  }
  if (decoded) {
    summary.bodyDecoded = decoded;
  }
  if (insights) {
    summary.insights = insights;
  }
  if (error) {
    summary.decodeError = error;
  }

  applyCorrelation(summary, options);

  return summary;
}

function applyCorrelation(
  summary: ProxyTrafficSummary,
  options?: BuildTrafficSummaryOptions
): void {
  if (options?.httpRequestId) {
    summary.httpRequestId = options.httpRequestId;
  }

  if (options?.bidiRequestId) {
    summary.insights = {
      ...summary.insights,
      agent: {
        ...summary.insights?.agent,
        requestId: options.bidiRequestId,
      },
    };
  }
}
