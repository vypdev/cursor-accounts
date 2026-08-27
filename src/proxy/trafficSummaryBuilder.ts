import { decodeProtoEntry, parseRpcPath } from './proxyDecode';
import { toTrafficSummary } from './proxyTrafficSummary';
import type { ProxyLogEntry, ProxyTrafficSummary } from './types';
import {
  shouldDecodeTrafficEntry,
  withTrafficSummaryCorrelation,
  type BuildTrafficSummaryOptions,
} from './trafficSummaryBuilderPolicy';

export type { BuildTrafficSummaryOptions } from './trafficSummaryBuilderPolicy';

/**
 * Build a traffic summary, optionally decoding Connect/protobuf bodies.
 */
export async function buildTrafficSummary(
  entry: ProxyLogEntry,
  durationMs?: number,
  options?: BuildTrafficSummaryOptions
): Promise<ProxyTrafficSummary> {
  const rpcPathFromUrl = parseRpcPath(entry.url);
  const shouldDecode = shouldDecodeTrafficEntry(
    entry,
    rpcPathFromUrl,
    options
  );

  if (!shouldDecode) {
    return withTrafficSummaryCorrelation(
      toTrafficSummary(entry, durationMs),
      options
    );
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

  return withTrafficSummaryCorrelation(summary, options);
}
