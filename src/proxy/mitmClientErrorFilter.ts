/**
 * Filters noisy https-mitm-proxy / httpolyglot clientError events that are common
 * with MITM (untrusted hosts, aborted tunnels, HTTP parser on non-HTTP bytes).
 */
export function shouldLogMitmClientError(
  errorKind: string | undefined,
  message: string
): boolean {
  if (errorKind !== 'HTTPS_CLIENT_ERROR') {
    return true;
  }

  const normalized = message.toLowerCase();

  if (normalized.includes('sslv3_alert_certificate_unknown')) {
    return false;
  }

  if (normalized.includes('parse error: invalid character in chunk size')) {
    return false;
  }

  if (normalized.includes('parse error: data after `connection: close`')) {
    return false;
  }

  if (normalized.includes('socket hang up')) {
    return false;
  }

  if (normalized.includes('ecconnreset') || normalized.includes('econnreset')) {
    return false;
  }

  return true;
}
