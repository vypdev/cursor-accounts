import type { ProxyLogEntry, ProxyTrafficSummary } from './types';

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
  const bodyBytes = getBodyBytes(entry);

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

function getBodyBytes(entry: ProxyLogEntry): number {
  return (
    entry.bodyRawBytes ??
    (entry.bodyBase64
      ? Buffer.from(entry.bodyBase64, 'base64').length
      : entry.body
        ? Buffer.byteLength(entry.body, 'utf8')
        : 0)
  );
}
