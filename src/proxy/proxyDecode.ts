import type { Type } from 'protobufjs';
import { isAgentServerStreamRpc } from './agentStreamDecode';
import { bodyBufferFromLogEntry } from './bodyFormat';
import {
  connectPayloadCandidates,
  prepareConnectPayload,
} from './connectDecode';
import {
  extractInsightsForRpc,
  redactSensitive,
  type ProxyInsights,
} from './proxyInsightExtractor';
import { getProtoRegistry } from './protoRegistry';
import type { ProxyLogEntry } from './types';
import {
  enrichInsightsFromAgentStream,
  finalizeInsights,
} from './proxyInsightEnricher';

const RPC_PATH_RE =
  /\/((?:aiserver|agent)\.v1\.[A-Za-z0-9_]+)\/([A-Za-z0-9_]+)/;

export interface DecodeProtoResult {
  decoded?: Record<string, unknown>;
  insights?: ProxyInsights;
  rpcPath?: string;
  error?: string;
}

export function parseRpcPath(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    if (
      /(?:aiserver|agent)\.v1\./.test(pathname) &&
      pathname.includes('Service/')
    ) {
      return pathname;
    }
  } catch {
    const match = url.match(RPC_PATH_RE);
    if (match) {
      return `/${match[1]}/${match[2]}`;
    }
  }
  return null;
}

export function messageTypeName(method: string, direction: 'request' | 'response'): string {
  const suffix = direction === 'request' ? 'Request' : 'Response';
  return `aiserver.v1.${method}${suffix}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface DecodeContext {
  rpcPath: string;
  direction: ProxyLogEntry['direction'];
  rawBody: Buffer;
  contentEncoding?: string;
}

async function buildDecodedResult(
  context: DecodeContext,
  decoded: Record<string, unknown>
): Promise<DecodeProtoResult> {
  const redacted = redactSensitive(decoded) as Record<string, unknown>;
  const insights = await finalizeInsights(
    context.rpcPath,
    context.direction,
    context.rawBody,
    context.contentEncoding,
    redacted,
    extractInsightsForRpc(context.rpcPath, redacted)
  );
  return {
    decoded: redacted,
    insights,
    rpcPath: context.rpcPath,
  };
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
    return buildDecodedResult({ rpcPath, direction: entry.direction, rawBody, contentEncoding }, decoded);
  } catch (error) {
    return {
      error: errorMessage(error),
      rpcPath,
    };
  }
}

function resolveMessageType(
  registry: Awaited<ReturnType<typeof getProtoRegistry>>,
  rpcPath: string,
  direction: ProxyLogEntry['direction']
): Type | undefined {
  const types = registry.getRpcTypes(rpcPath);
  if (types) {
    return direction === 'request' ? types.requestType : types.responseType;
  }

  const match = rpcPath.match(RPC_PATH_RE);
  const methodName = match?.[2];
  if (!methodName) {
    return undefined;
  }

  const typeName = messageTypeName(
    methodName,
    direction === 'request' ? 'request' : 'response'
  );
  return registry.lookupMessageType(typeName) ?? undefined;
}

function decodePayloads(
  registry: Awaited<ReturnType<typeof getProtoRegistry>>,
  type: Type,
  payloads: Buffer[]
): { decoded?: Record<string, unknown>; error?: string } {
  let lastError: string | undefined;
  for (const payload of payloads) {
    try {
      return { decoded: registry.decode(type, payload) };
    } catch (error) {
      lastError = errorMessage(error);
    }
  }
  return { error: lastError };
}

async function decodeBinaryPayloads(
  entry: ProxyLogEntry,
  rawBody: Buffer,
  rpcPath: string,
  contentEncoding: string | undefined
): Promise<DecodeProtoResult> {
  try {
    const registry = await getProtoRegistry();
    const type = resolveMessageType(registry, rpcPath, entry.direction);
    if (!type) {
      return { error: `Unknown RPC: ${rpcPath}`, rpcPath };
    }

    const payloads = entry.bodyDecompressed
      ? connectPayloadCandidates(rawBody)
      : prepareConnectPayload(rawBody, contentEncoding);

    const decodedResult = decodePayloads(registry, type, payloads);
    if (decodedResult.decoded) {
      return buildDecodedResult(
        { rpcPath, direction: entry.direction, rawBody, contentEncoding },
        decodedResult.decoded
      );
    }

    if (
      (entry.direction === 'request' || entry.direction === 'response') &&
      isAgentServerStreamRpc(rpcPath, entry.direction)
    ) {
      const insights = await enrichInsightsFromAgentStream(
        rpcPath,
        entry.direction,
        rawBody,
        contentEncoding,
        undefined
      );
      if (insights && (insights.agent || insights.tokens)) {
        return { insights, rpcPath };
      }
    }

    return { error: decodedResult.error ?? 'decode failed', rpcPath };
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

  return decodeBinaryPayloads(entry, rawBody, rpcPath, contentEncoding);
}
