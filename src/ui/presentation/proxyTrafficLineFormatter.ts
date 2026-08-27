import type { AgentSessionInfo } from '../../domain/types/agentTracking';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';

export const PROXY_TRAFFIC_TAG = '[ProxyTraffic]';

export function formatTrafficLine(
  summary: ProxyTrafficSummary,
  timeLabel?: string
): string {
  const time =
    timeLabel ??
    new Date(summary.timestamp).toLocaleTimeString(undefined, {
      hour12: false,
    });
  const target = summary.endpoint.startsWith('http')
    ? summary.endpoint
    : `${summary.host}${summary.endpoint.startsWith('/') ? '' : '/'}${summary.endpoint}`;

  if (summary.kind === 'error') {
    const detail = summary.errorMessage ?? 'unknown error';
    return `[${time}] ${PROXY_TRAFFIC_TAG} ✗ ${summary.errorKind ?? 'PROXY_ERROR'} ${target} — ${detail}`;
  }

  if (summary.kind === 'request') {
    const method = summary.method ?? 'GET';
    const meta = [
      summary.userAgent,
      summary.bodyKind !== 'empty' ? summary.bodyKind : undefined,
      summary.requestId ? `id=${summary.requestId.slice(0, 8)}` : undefined,
    ]
      .filter(Boolean)
      .join(', ');
    return `[${time}] ${PROXY_TRAFFIC_TAG} → ${method} ${target}${meta ? ` (${meta})` : ''}`;
  }

  const status = summary.statusCode ?? '?';
  const meta = formatResponseMetadata(summary);
  return `[${time}] ${PROXY_TRAFFIC_TAG} ← ${status} ${target}${meta}`;
}

function formatResponseMetadata(summary: ProxyTrafficSummary): string {
  if (!summary.bodyKind) {
    return '';
  }

  const size =
    summary.bodyBytes != null && summary.bodyBytes > 0
      ? `${summary.bodyBytes} B`
      : '0 B';
  const duration =
    summary.durationMs != null ? `, ${summary.durationMs} ms` : '';
  const insightHint = formatInsightHint(summary);
  const decodeHint = summary.decodeError
    ? ', decode-err'
    : summary.bodyDecoded
      ? ', decoded'
      : '';
  return ` (${size}, ${summary.bodyKind}${duration}${decodeHint}${insightHint})`;
}

function formatInsightHint(summary: ProxyTrafficSummary): string {
  const parts = [
    formatSpendHint(summary),
    formatTokenHint(summary),
    formatEstimatedCostHint(summary),
    formatMessageCountHint(summary),
    formatAgentRequestHint(summary),
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? `, ${parts.join(', ')}` : '';
}

function formatSpendHint(summary: ProxyTrafficSummary): string | undefined {
  const spend = summary.insights?.billing?.spendLimit?.currentSpendUsd;
  return spend != null ? `$${spend.toFixed(2)}` : undefined;
}

function formatTokenHint(summary: ProxyTrafficSummary): string | undefined {
  const agent = summary.insights?.agent;
  const billed = sumAgentTokens(agent);
  const totalTokens = summary.insights?.tokens?.totalTokens;
  const liveTokens =
    billed > 0 ? billed : agent?.streamingTokens ?? totalTokens;
  if (liveTokens == null) {
    return undefined;
  }

  if (agent?.usageEvent === 'turn_ended') {
    return `${liveTokens} tok (turn)`;
  }
  if (agent?.streamingTokens != null) {
    return `${liveTokens} tok (live)`;
  }
  return `${liveTokens} tok`;
}

function sumAgentTokens(agent: AgentSessionInfo | undefined): number {
  if (!agent) {
    return 0;
  }
  return (
    (agent.inputTokens ?? 0) +
    (agent.outputTokens ?? 0) +
    (agent.cacheReadTokens ?? 0) +
    (agent.cacheWriteTokens ?? 0)
  );
}

function formatEstimatedCostHint(
  summary: ProxyTrafficSummary
): string | undefined {
  const cost = summary.insights?.agent?.estimatedCostUsd;
  return cost != null && cost > 0 ? `~$${cost.toFixed(2)}` : undefined;
}

function formatMessageCountHint(
  summary: ProxyTrafficSummary
): string | undefined {
  const count = summary.insights?.context?.messageCount;
  return count != null ? `${count} msgs` : undefined;
}

function formatAgentRequestHint(
  summary: ProxyTrafficSummary
): string | undefined {
  const requestId = summary.insights?.agent?.requestId;
  return requestId ? `agent=${requestId.slice(0, 8)}` : undefined;
}
