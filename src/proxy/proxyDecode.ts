import { bodyBufferFromLogEntry } from './bodyFormat';
import { decodeBinaryPayloads } from './proxyBinaryDecoder';
import { buildDecodedResult } from './proxyDecodedResultBuilder';
import type { DecodeProtoResult } from './proxyDecodeTypes';
import { parseRpcPath } from './proxyRpcPath';
import type { ProxyLogEntry } from './types';

export type { DecodeProtoResult } from './proxyDecodeTypes';
export { messageTypeName, parseRpcPath } from './proxyRpcPath';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function decodeJsonEntry(
  entry: ProxyLogEntry,
  rawBody: Buffer,
  rpcPath: string,
  contentEncoding: string | undefined
): Promise<DecodeProtoResult> {
  try {
    const decoded = JSON.parse(
      entry.body ?? Buffer.from(rawBody).toString('utf8')
    ) as Record<string, unknown>;
    return buildDecodedResult(
      { rpcPath, direction: entry.direction, rawBody, contentEncoding },
      decoded
    );
  } catch (error) {
    return {
      error: errorMessage(error),
      rpcPath,
    };
  }
}

/**
 * Decode a proxy log entry body using extracted protos.
 */
export async function decodeProtoEntry(
  entry: ProxyLogEntry,
  options?: { logDir?: string }
): Promise<DecodeProtoResult> {
  const rawBody = bodyBufferFromLogEntry(entry, options?.logDir);
  if (!rawBody || rawBody.length === 0) {
    return { error: 'No body data' };
  }

  const rpcPath = parseRpcPath(entry.url);
  if (!rpcPath) {
    return { error: 'Not a Connect RPC URL (aiserver/agent)' };
  }

  const contentType = entry.headers['content-type']?.toLowerCase() ?? '';
  const contentEncoding = entry.headers['content-encoding'];

  if (contentType.includes('json')) {
    return decodeJsonEntry(entry, rawBody, rpcPath, contentEncoding);
  }

  return decodeBinaryPayloads(entry, {
    rpcPath,
    direction: entry.direction,
    rawBody,
    contentEncoding,
  });
}
