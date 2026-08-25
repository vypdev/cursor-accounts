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
    try {
      const decoded = JSON.parse(
        entry.body ?? Buffer.from(rawBody).toString('utf8')
      ) as Record<string, unknown>;
      const redacted = redactSensitive(decoded) as Record<string, unknown>;
      const insights = await finalizeInsights(
        rpcPath,
        entry.direction,
        rawBody,
        contentEncoding,
        redacted,
        extractInsightsForRpc(rpcPath, redacted)
      );
      return {
        decoded: redacted,
        insights,
        rpcPath,
      };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
        rpcPath,
      };
    }
  }

  try {
    const registry = await getProtoRegistry();
    let type: Type | undefined;

    const types = registry.getRpcTypes(rpcPath);
    if (types) {
      type =
        entry.direction === 'request' ? types.requestType : types.responseType;
    } else {
      const match = rpcPath.match(RPC_PATH_RE);
      const methodName = match?.[2];
      if (methodName) {
        const typeName = messageTypeName(
          methodName,
          entry.direction === 'request' ? 'request' : 'response'
        );
        type = registry.lookupMessageType(typeName) ?? undefined;
      }
    }

    if (!type) {
      return { error: `Unknown RPC: ${rpcPath}`, rpcPath };
    }

    const payloads = entry.bodyDecompressed
      ? connectPayloadCandidates(rawBody)
      : prepareConnectPayload(rawBody, contentEncoding);

    let lastError: string | undefined;
    for (const payload of payloads) {
      try {
        const decoded = registry.decode(type, payload);
        const redacted = redactSensitive(decoded) as Record<string, unknown>;
        const insights = await finalizeInsights(
          rpcPath,
          entry.direction,
          rawBody,
          contentEncoding,
          redacted,
          extractInsightsForRpc(rpcPath, redacted)
        );
        return {
          decoded: redacted,
          insights,
          rpcPath,
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (entry.direction === 'request' || entry.direction === 'response') {
      if (isAgentServerStreamRpc(rpcPath, entry.direction)) {
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
    }

    return { error: lastError ?? 'decode failed', rpcPath };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      rpcPath,
    };
  }
}
