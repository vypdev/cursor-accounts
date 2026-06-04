import type { Type } from 'protobufjs';
import {
  isAgentServerStreamRpc,
  scanConnectAgentServerStream,
} from './agentStreamDecode';
import {
  bidiInnerRoleForRpc,
  decodeBidiAgentPayload,
} from './bidiAgentDecode';
import { bodyBufferFromLogEntry } from './bodyFormat';
import {
  connectPayloadCandidates,
  decompressBody,
  prepareConnectPayload,
} from './connectDecode';
import {
  extractAgentInnerInsights,
  extractConversationAndSubagentIds,
  extractInsightsForRpc,
  mergeAgentSessionInfo,
  redactSensitive,
  type AgentSessionInfo,
  type ProxyInsights,
} from './proxyInsightExtractor';
import { getProtoRegistry } from './protoRegistry';
import type { ProxyLogEntry } from './types';

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

async function enrichInsightsFromBidi(
  rpcPath: string,
  direction: 'request' | 'response',
  decoded: Record<string, unknown>,
  insights: ProxyInsights | undefined
): Promise<ProxyInsights | undefined> {
  const role = bidiInnerRoleForRpc(rpcPath, direction);
  if (!role) {
    return insights;
  }

  const registry = await getProtoRegistry();
  const inner = decodeBidiAgentPayload(
    registry,
    decoded.data,
    decoded.dataBinary ?? decoded.data_binary,
    role
  );
  if (!inner) {
    return insights;
  }

  const next: ProxyInsights = { ...(insights ?? {}) };
  const relationshipIds = extractConversationAndSubagentIds(inner);
  if (Object.keys(relationshipIds).length > 0) {
    next.agent = mergeAgentSessionInfo(next.agent, relationshipIds);
    if (relationshipIds.conversationId || relationshipIds.conversationGroupId) {
      next.context = {
        ...next.context,
        conversationId:
          relationshipIds.conversationId ?? next.context?.conversationId,
        conversationGroupId:
          relationshipIds.conversationGroupId ?? next.context?.conversationGroupId,
      };
    }
  }

  const innerAgent = extractAgentInnerInsights(inner);
  if (!innerAgent) {
    return Object.keys(next).length > 0 ? next : insights;
  }

  return applyAgentSessionInsights(next, innerAgent);
}

function applyAgentSessionInsights(
  insights: ProxyInsights | undefined,
  agent: AgentSessionInfo | undefined
): ProxyInsights | undefined {
  if (!agent) {
    return insights;
  }

  const next: ProxyInsights = { ...(insights ?? {}) };
  next.agent = mergeAgentSessionInfo(next.agent, agent);

  if (agent.inputTokens != null || agent.outputTokens != null) {
    next.tokens = {
      promptTokens: agent.inputTokens,
      completionTokens: agent.outputTokens,
      totalTokens:
        agent.inputTokens != null && agent.outputTokens != null
          ? agent.inputTokens + agent.outputTokens
          : undefined,
      cachedTokens: agent.cacheReadTokens,
    };
  } else if (agent.streamingTokens != null) {
    next.tokens = {
      totalTokens: agent.streamingTokens,
    };
  }

  return next;
}

async function enrichInsightsFromAgentStream(
  rpcPath: string,
  direction: 'request' | 'response',
  rawBody: Buffer,
  contentEncoding: string | undefined,
  insights: ProxyInsights | undefined
): Promise<ProxyInsights | undefined> {
  if (!isAgentServerStreamRpc(rpcPath, direction)) {
    return insights;
  }

  const registry = await getProtoRegistry();
  const body = decompressBody(rawBody, contentEncoding);
  const scan = scanConnectAgentServerStream(registry, body);
  if (scan.messageCount === 0 && Object.keys(scan.relationshipIds).length === 0) {
    return insights;
  }

  let next: ProxyInsights = { ...(insights ?? {}) };

  if (Object.keys(scan.relationshipIds).length > 0) {
    next.agent = mergeAgentSessionInfo(next.agent, scan.relationshipIds);
    if (scan.relationshipIds.conversationId || scan.relationshipIds.conversationGroupId) {
      next.context = {
        ...next.context,
        conversationId:
          scan.relationshipIds.conversationId ?? next.context?.conversationId,
        conversationGroupId:
          scan.relationshipIds.conversationGroupId ??
          next.context?.conversationGroupId,
      };
    }
  }

  next = applyAgentSessionInsights(next, scan.mergedAgent ?? undefined) ?? next;
  if (scan.allTokenFrames.length > 0) {
    next.allTokenFrames = scan.allTokenFrames;
  }
  return Object.keys(next).length > 0 ? next : insights;
}

async function finalizeInsights(
  rpcPath: string,
  direction: ProxyLogEntry['direction'],
  rawBody: Buffer,
  contentEncoding: string | undefined,
  decoded: Record<string, unknown>,
  insights: ProxyInsights | undefined
): Promise<ProxyInsights | undefined> {
  if (direction !== 'request' && direction !== 'response') {
    return insights;
  }

  let next = insights;
  next = await enrichInsightsFromBidi(rpcPath, direction, decoded, next);
  next = await enrichInsightsFromAgentStream(
    rpcPath,
    direction,
    rawBody,
    contentEncoding,
    next
  );
  return next;
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
