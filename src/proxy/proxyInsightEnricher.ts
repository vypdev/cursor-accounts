import {
  isAgentServerStreamRpc,
  scanConnectAgentServerStream,
} from './agentStreamDecode';
import {
  bidiInnerRoleForRpc,
  decodeBidiAgentPayload,
} from './bidiAgentDecode';
import { decompressBody } from './connectDecode';
import {
  extractAgentInnerInsights,
  extractAgentRunRequestInfo,
  extractConversationAndSubagentIds,
  mergeAgentSessionInfo,
  type AgentSessionInfo,
  type ProxyInsights,
} from './proxyInsightExtractor';
import { getProtoRegistry } from './protoRegistry';
import type { ProxyLogEntry } from './types';

export async function finalizeInsights(
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

/** Apply agent token fields and session identifiers to an existing insight set. */
export function applyAgentSessionInsights(
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
      cacheReadTokens: agent.cacheReadTokens,
      cacheWriteTokens: agent.cacheWriteTokens,
      totalCents: agent.totalCents,
    };
  } else if (agent.streamingTokens != null) {
    next.tokens = {
      totalTokens: agent.streamingTokens,
    };
  }

  return next;
}

function applyRelationshipInsights(
  insights: ProxyInsights,
  relationshipIds: Partial<AgentSessionInfo>
): ProxyInsights {
  if (Object.keys(relationshipIds).length === 0) {
    return insights;
  }

  const next: ProxyInsights = { ...insights };
  next.agent = mergeAgentSessionInfo(next.agent, relationshipIds);
  if (relationshipIds.conversationId || relationshipIds.conversationGroupId) {
    next.context = {
      ...next.context,
      conversationId:
        relationshipIds.conversationId ?? next.context?.conversationId,
      conversationGroupId:
        relationshipIds.conversationGroupId ??
        next.context?.conversationGroupId,
    };
  }
  return next;
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

  let next: ProxyInsights = { ...(insights ?? {}) };
  const relationshipIds = extractConversationAndSubagentIds(inner);
  const runRequestInfo = extractAgentRunRequestInfo(inner);
  const mergedIds = mergeAgentSessionInfo(
    relationshipIds,
    runRequestInfo ?? undefined
  );
  next = applyRelationshipInsights(next, mergedIds ?? {});

  const innerAgent = extractAgentInnerInsights(inner);
  if (!innerAgent) {
    return Object.keys(next).length > 0 ? next : insights;
  }

  return applyAgentSessionInsights(next, innerAgent);
}

export async function enrichInsightsFromAgentStream(
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
  next = applyRelationshipInsights(next, scan.relationshipIds);

  next = applyAgentSessionInsights(next, scan.mergedAgent ?? undefined) ?? next;
  if (scan.allTokenFrames.length > 0) {
    next.allTokenFrames = scan.allTokenFrames;
  }
  return Object.keys(next).length > 0 ? next : insights;
}
