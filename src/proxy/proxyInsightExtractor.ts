import { extractBillingInfo, extractTokenUsage } from './insights/usageExtraction';
import { extractConversationContext } from './insights/contextExtraction';
import {
  extractAgentSessionInfo,
  extractWorkspaceInfo,
  mergeAgentSessionInfo,
} from './insights/agentExtraction';

export { extractBillingInfo, extractTokenUsage } from './insights/usageExtraction';
export { extractConversationContext } from './insights/contextExtraction';
export {
  definedAgentFields,
  estimateTokenCostUsd,
  extractAgentInnerInsights,
  extractAgentRunRequestInfo,
  extractAgentSessionInfo,
  extractConversationAndSubagentIds,
  mergeAgentSessionInfo,
  MAX_SANE_TURN_TOKENS,
} from './insights/agentExtraction';

export type { AgentSessionInfo } from '../application/types/agentTracking';
import type { ProxyInsights } from '../application/types/proxyInsights';

export type { ConversationContext, ProxyInsights } from '../application/types/proxyInsights';
export type { BillingInfo, TokenUsageInfo } from './insights/usageExtraction';

const SENSITIVE_FIELD_RE =
  /^(authorization|token|api[_-]?key|secret|password|cookie|refresh[_-]?token|access[_-]?token)$/i;

/**
 * Redact sensitive fields from decoded protobuf objects before display/logging.
 */
export function redactSensitive(obj: unknown, depth = 0): unknown {
  if (depth > 12 || obj == null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitive(item, depth + 1));
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  const record = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_FIELD_RE.test(key)) {
      out[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      out[key] = redactSensitive(value, depth + 1);
    } else {
      out[key] = value;
    }
  }

  return out;
}

function isAgentInteractiveRpc(rpcPath: string): boolean {
  return (
    rpcPath.includes('RunPoll') ||
    rpcPath.includes('RunSSE') ||
    rpcPath.includes('AgentService/Run') ||
    rpcPath.includes('BidiAppend') ||
    rpcPath.includes('BidiPoll') ||
    rpcPath.includes('StreamBidi')
  );
}

/**
 * Pick insights based on RPC path.
 */
export function extractInsightsForRpc(
  rpcPath: string,
  decoded: Record<string, unknown>
): ProxyInsights | undefined {
  const insights: ProxyInsights = {};

  if (rpcPath.includes('GetCurrentPeriodUsage') || rpcPath.includes('GetPlanInfo')) {
    insights.billing = extractBillingInfo(decoded) ?? undefined;
  }

  if (
    rpcPath.includes('StreamComposer') ||
    rpcPath.includes('StreamChat') ||
    rpcPath.includes('GetTokenUsage')
  ) {
    insights.tokens = extractTokenUsage(decoded) ?? undefined;
  }

  if (
    rpcPath.includes('StreamComposer') ||
    rpcPath.includes('StreamChat') ||
    rpcPath.includes('Conversation')
  ) {
    insights.context = extractConversationContext(decoded) ?? undefined;
  }

  if (isAgentInteractiveRpc(rpcPath)) {
    insights.agent = extractAgentSessionInfo(decoded) ?? undefined;
    insights.workspace = extractWorkspaceInfo(decoded) ?? undefined;
  }

  const usageUuid =
    (typeof decoded.usage_uuid === 'string' && decoded.usage_uuid) ||
    (typeof decoded.usageUuid === 'string' && decoded.usageUuid) ||
    undefined;
  if (usageUuid) {
    insights.agent = mergeAgentSessionInfo(insights.agent, {
      usageUuid,
      usageEvent: 'usage_uuid',
    });
  }

  if (!insights.billing && !insights.tokens && !insights.context && !insights.agent && !insights.workspace) {
    return undefined;
  }

  return insights;
}
