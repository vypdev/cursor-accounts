import {
  CONNECT_RPC_CONTENT_TYPE,
  CURSOR_HOST_SUFFIXES,
} from '../types';

export function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) {
      continue;
    }
    result[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

const SENSITIVE_HEADER_PATTERN = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$/i;

/** Remove credentials and session material before a header map is persisted or displayed. */
export function redactHeadersForLog(
  headers: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_HEADER_PATTERN.test(key) ? '[REDACTED]' : value,
    ])
  );
}

export function isConnectRpcContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }
  const lower = contentType.toLowerCase();
  return (
    lower.includes(CONNECT_RPC_CONTENT_TYPE) ||
    lower.includes('application/proto') ||
    lower.includes('application/connect') ||
    lower.includes('application/grpc') ||
    lower.includes('application/grpc+proto')
  );
}

export function isCursorHost(host: string): boolean {
  const lower = host.toLowerCase();
  return CURSOR_HOST_SUFFIXES.some(
    (suffix) => lower === suffix || lower.endsWith(`.${suffix}`)
  );
}

/** Short endpoint label from URL and host (RPC path or path segment). */
export function inferEndpointPath(url: string, host: string): string {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${host}${url}`);
    const path = parsed.pathname;
    if (path && path !== '/') {
      return path;
    }
  } catch {
    // fall through
  }
  if (url.startsWith('/')) {
    return url.split('?')[0] ?? url;
  }
  return url;
}
