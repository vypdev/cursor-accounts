import { decodeProtoEntry } from './proxyDecode';
import { toTrafficSummary } from './proxyTrafficFormat';
import type { ProxyLogEntry, ProxyTrafficSummary } from './types';

/**
 * Build a traffic summary, optionally decoding Connect/protobuf bodies.
 */
export async function buildTrafficSummary(
  entry: ProxyLogEntry,
  durationMs?: number,
  options?: { decode?: boolean }
): Promise<ProxyTrafficSummary> {
  const shouldDecode =
    options?.decode !== false &&
    entry.isConnectRpc &&
    (entry.direction === 'request' || entry.direction === 'response') &&
    Boolean(entry.body ?? entry.bodyBase64);

  if (!shouldDecode) {
    return toTrafficSummary(entry, durationMs);
  }

  const { decoded, insights, rpcPath, error } = await decodeProtoEntry(entry);
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

  return summary;
}
