export function normalizeHostKey(host: string, url: string): string {
  const raw = (host || url).trim().toLowerCase();
  if (!raw) {
    return '';
  }
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return new URL(raw).host.toLowerCase();
    }
  } catch {
    // Fall through to the proxy's host-oriented normalization.
  }
  return raw.replace(/^\/+/, '').split('/')[0]?.split(':')[0] ?? raw;
}

export function cloneProtocolByHost(
  source: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  const clone: Record<string, Record<string, number>> = {};
  for (const [host, protocols] of Object.entries(source)) {
    clone[host] = { ...protocols };
  }
  return clone;
}
