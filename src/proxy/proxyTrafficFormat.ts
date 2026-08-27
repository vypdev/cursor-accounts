import type { ProxyLogEntry, ProxyTrafficSummary } from './types';
import type { AgentSessionInfo } from '../domain/types/agentTracking';

export const PROXY_TRAFFIC_TAG = '[ProxyTraffic]';

export { redactHeadersForLog } from './utils/proxyRequestMetadata';

export function extractRequestId(
  headers: Record<string, string>
): string | undefined {
  return headers['x-request-id'] ?? headers['traceparent'];
}

export function abbreviateUserAgent(userAgent: string | undefined): string {
  if (!userAgent) {
    return 'unknown';
  }
  if (userAgent.startsWith('connect-es/')) {
    return 'connect-es';
  }
  if (userAgent.startsWith('connect-es')) {
    return 'connect-es';
  }
  const slash = userAgent.indexOf('/');
  if (slash > 0 && slash < 24) {
    return userAgent.slice(0, slash);
  }
  return userAgent.length > 24 ? `${userAgent.slice(0, 24)}…` : userAgent;
}

export function classifyBodyKind(
  contentType: string | undefined,
  bodyBytes: number
): ProxyTrafficSummary['bodyKind'] {
  if (bodyBytes === 0) {
    return 'empty';
  }
  const lower = contentType?.toLowerCase() ?? '';
  if (lower.includes('json')) {
    return 'json';
  }
  if (
    lower.includes('proto') ||
    lower.includes('connect') ||
    lower.includes('grpc')
  ) {
    return 'proto';
  }
  return 'text';
}

export function formatEndpoint(url: string, host: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.host === host || parsed.hostname === host.split(':')[0]) {
      const path = `${parsed.pathname}${parsed.search}`;
      return path.length > 0 ? path : '/';
    }
    return url;
  } catch {
    return url;
  }
}

export function toTrafficSummary(
  entry: ProxyLogEntry,
  durationMs?: number
): ProxyTrafficSummary {
  if (entry.direction === 'error') {
    return {
      timestamp: entry.timestamp,
      kind: 'error',
      url: entry.url,
      host: entry.host,
      endpoint: formatEndpoint(entry.url, entry.host),
      errorKind: entry.errorKind,
      errorMessage: entry.errorMessage,
      isCursorHost: entry.isCursorHost,
    };
  }

  const contentType = entry.headers['content-type'];
  const bodyBytes =
    entry.bodyRawBytes ??
    (entry.bodyBase64
      ? Buffer.from(entry.bodyBase64, 'base64').length
      : entry.body
        ? Buffer.byteLength(entry.body, 'utf8')
        : 0);

  return {
    timestamp: entry.timestamp,
    kind: entry.direction,
    method: entry.method,
    url: entry.url,
    host: entry.host,
    endpoint: formatEndpoint(entry.url, entry.host),
    statusCode: entry.statusCode,
    bodyBytes,
    bodyKind: classifyBodyKind(contentType, bodyBytes),
    userAgent: abbreviateUserAgent(entry.headers['user-agent']),
    requestId: extractRequestId(entry.headers),
    isCursorHost: entry.isCursorHost,
    durationMs,
    protocolVersion: entry.protocolVersion,
  };
}

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

function sumAgentTokens(
  agent: AgentSessionInfo | undefined
): number {
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
