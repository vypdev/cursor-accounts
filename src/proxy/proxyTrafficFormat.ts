import type { ProxyLogEntry, ProxyTrafficSummary } from './types';

export const PROXY_TRAFFIC_TAG = '[ProxyTraffic]';

const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
]);

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
  const bodyBytes = entry.body
    ? Buffer.byteLength(entry.body, 'utf8')
    : 0;

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
  const size =
    summary.bodyBytes != null && summary.bodyBytes > 0
      ? `${summary.bodyBytes} B`
      : '0 B';
  const duration =
    summary.durationMs != null ? `, ${summary.durationMs} ms` : '';
  const meta = summary.bodyKind ? ` (${size}, ${summary.bodyKind}${duration})` : '';
  return `[${time}] ${PROXY_TRAFFIC_TAG} ← ${status} ${target}${meta}`;
}

export function redactHeadersForLog(
  headers: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  }
  return result;
}
