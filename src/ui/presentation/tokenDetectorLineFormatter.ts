import type { AgentSessionInfo } from '../../application/types/agentTracking';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';

export const TOKEN_DETECTOR_TAG = '[TokenDetector]';

function shortId(value: string | undefined, length = 8): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length <= length ? value : value.slice(0, length);
}

function isAgentRpc(rpc: string): boolean {
  return /AgentService|BidiService|BidiAppend|BidiPoll|RunPoll|RunSSE|StreamBidi/i.test(
    rpc
  );
}

function hasTokenDetectorInsights(summary: ProxyTrafficSummary): boolean {
  const agent = summary.insights?.agent;
  const tokens = summary.insights?.tokens;
  const context = summary.insights?.context;

  return Boolean(
    agent?.requestId ||
      agent?.conversationId ||
      agent?.conversationGroupId ||
      agent?.parentRequestId ||
      agent?.subagentRequestId ||
      agent?.streamingTokens != null ||
      agent?.inputTokens != null ||
      agent?.usageEvent ||
      tokens?.totalTokens != null ||
      tokens?.modelName ||
      context?.conversationId ||
      context?.conversationGroupId
  );
}

function formatTokenParts(agent: AgentSessionInfo | undefined): string[] {
  if (!agent) {
    return [];
  }

  const parts: string[] = [];
  if (agent.usageEvent) {
    parts.push(`event=${agent.usageEvent}`);
  }
  if (agent.streamingTokens != null) {
    parts.push(`stream=${agent.streamingTokens}`);
  }
  if (agent.inputTokens != null) {
    parts.push(`in=${agent.inputTokens}`);
  }
  if (agent.outputTokens != null) {
    parts.push(`out=${agent.outputTokens}`);
  }
  if (agent.cacheReadTokens != null) {
    parts.push(`cacheR=${agent.cacheReadTokens}`);
  }
  if (agent.cacheWriteTokens != null) {
    parts.push(`cacheW=${agent.cacheWriteTokens}`);
  }
  if (agent.estimatedCostUsd != null && agent.estimatedCostUsd > 0) {
    parts.push(`~$${agent.estimatedCostUsd.toFixed(3)}`);
  }
  if (agent.eof) {
    parts.push('eof');
  }
  return parts;
}

function appendIdentityFields(
  fields: string[],
  summary: ProxyTrafficSummary
): void {
  const agent = summary.insights?.agent;
  const context = summary.insights?.context;
  const conversationId = agent?.conversationId ?? context?.conversationId;
  const conversationGroupId =
    agent?.conversationGroupId ?? context?.conversationGroupId;

  if (conversationId) {
    fields.push(`conv=${shortId(conversationId, 12)}`);
  }
  if (conversationGroupId) {
    fields.push(`group=${shortId(conversationGroupId, 12)}`);
  }
  if (agent?.requestId) {
    fields.push(`agent=${shortId(agent.requestId, 12)}`);
  }
  if (agent?.parentRequestId) {
    fields.push(`parent=${shortId(agent.parentRequestId, 12)}`);
  }
  if (agent?.subagentRequestId) {
    fields.push(`subagent=${shortId(agent.subagentRequestId, 12)}`);
  }
}

function appendTrafficFields(
  fields: string[],
  summary: ProxyTrafficSummary,
  profileId: string | undefined
): void {
  const rpc = summary.rpcPath ?? summary.endpoint;
  if (profileId) {
    fields.push(`profile=${shortId(profileId, 8)}`);
  }
  if (rpc) {
    fields.push(`rpc=${rpc.replace(/^\/+/, '')}`);
  }
  if (summary.kind !== 'error') {
    fields.push(summary.kind === 'request' ? '→ req' : '← resp');
  }
}

function appendUsageFields(fields: string[], summary: ProxyTrafficSummary): void {
  const agent = summary.insights?.agent;
  const tokens = summary.insights?.tokens;
  const model = tokens?.modelName ?? agent?.modelName;

  if (model) {
    fields.push(`model=${model}`);
  }
  fields.push(...formatTokenParts(agent));
  if (
    tokens?.totalTokens != null &&
    agent?.streamingTokens == null &&
    agent?.inputTokens == null
  ) {
    fields.push(`total=${tokens.totalTokens}`);
  }
  if (summary.decodeError) {
    fields.push(`decodeErr=${summary.decodeError}`);
  }
}

/**
 * Format live proxy traffic for the token/agent detector channel.
 * Returns null when the event has nothing useful for token or agent tracking.
 */
export function formatTokenDetectorLine(
  summary: ProxyTrafficSummary,
  profileId?: string
): string | null {
  const rpc = summary.rpcPath ?? summary.endpoint;
  const hasInsights = hasTokenDetectorInsights(summary);
  if (!hasInsights && !isAgentRpc(rpc)) {
    return null;
  }

  const fields: string[] = [];
  appendTrafficFields(fields, summary, profileId);
  appendIdentityFields(fields, summary);
  appendUsageFields(fields, summary);

  if (fields.length <= (profileId ? 3 : 2) && !hasInsights) {
    return null;
  }

  const time = new Date(summary.timestamp).toLocaleTimeString(undefined, {
    hour12: false,
  });
  return `[${time}] ${TOKEN_DETECTOR_TAG} ${fields.join(' ')}`;
}
