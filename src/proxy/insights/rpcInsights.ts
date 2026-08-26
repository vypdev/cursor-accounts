import type { ProxyInsights } from '../../application/types/proxyInsights';
import {
  extractAgentSessionInfo,
  extractWorkspaceInfo,
  mergeAgentSessionInfo,
} from './agentExtraction';
import { extractConversationContext } from './contextExtraction';
import { extractBillingInfo, extractTokenUsage } from './usageExtraction';

function addBillingInsights(
  rpcPath: string,
  decoded: Record<string, unknown>,
  insights: ProxyInsights
): void {
  if (
    rpcPath.includes('GetCurrentPeriodUsage') ||
    rpcPath.includes('GetPlanInfo')
  ) {
    insights.billing = extractBillingInfo(decoded) ?? undefined;
  }
}

function addTokenInsights(
  rpcPath: string,
  decoded: Record<string, unknown>,
  insights: ProxyInsights
): void {
  if (
    rpcPath.includes('StreamComposer') ||
    rpcPath.includes('StreamChat') ||
    rpcPath.includes('GetTokenUsage')
  ) {
    insights.tokens = extractTokenUsage(decoded) ?? undefined;
  }
}

function addContextInsights(
  rpcPath: string,
  decoded: Record<string, unknown>,
  insights: ProxyInsights
): void {
  if (
    rpcPath.includes('StreamComposer') ||
    rpcPath.includes('StreamChat') ||
    rpcPath.includes('Conversation')
  ) {
    insights.context = extractConversationContext(decoded) ?? undefined;
  }
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

function addAgentInsights(
  rpcPath: string,
  decoded: Record<string, unknown>,
  insights: ProxyInsights
): void {
  if (!isAgentInteractiveRpc(rpcPath)) {
    return;
  }

  insights.agent = extractAgentSessionInfo(decoded) ?? undefined;
  insights.workspace = extractWorkspaceInfo(decoded) ?? undefined;
}

function extractUsageUuid(
  decoded: Record<string, unknown>
): string | undefined {
  return (
    (typeof decoded.usage_uuid === 'string' && decoded.usage_uuid) ||
    (typeof decoded.usageUuid === 'string' && decoded.usageUuid) ||
    undefined
  );
}

function addUsageUuidInsight(
  decoded: Record<string, unknown>,
  insights: ProxyInsights
): void {
  const usageUuid = extractUsageUuid(decoded);
  if (!usageUuid) {
    return;
  }

  insights.agent = mergeAgentSessionInfo(insights.agent, {
    usageUuid,
    usageEvent: 'usage_uuid',
  });
}

function hasInsights(insights: ProxyInsights): boolean {
  return Boolean(
    insights.billing ||
      insights.tokens ||
      insights.context ||
      insights.agent ||
      insights.workspace
  );
}

/** Pick decoded insights based on the RPC path. */
export function extractInsightsForRpc(
  rpcPath: string,
  decoded: Record<string, unknown>
): ProxyInsights | undefined {
  const insights: ProxyInsights = {};
  addBillingInsights(rpcPath, decoded, insights);
  addTokenInsights(rpcPath, decoded, insights);
  addContextInsights(rpcPath, decoded, insights);
  addAgentInsights(rpcPath, decoded, insights);
  addUsageUuidInsight(decoded, insights);

  return hasInsights(insights) ? insights : undefined;
}
