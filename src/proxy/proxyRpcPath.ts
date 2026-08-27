const RPC_PATH_RE =
  /\/((?:aiserver|agent)\.v1\.[A-Za-z0-9_]+)\/([A-Za-z0-9_]+)/;

export function parseRpcPath(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    if (
      /(?:aiserver|agent)\.v1\./.test(pathname) &&
      pathname.includes('Service/')
    ) {
      return pathname;
    }
  } catch {
    const match = url.match(RPC_PATH_RE);
    if (match) {
      return `/${match[1]}/${match[2]}`;
    }
  }
  return null;
}

export function messageTypeName(
  method: string,
  direction: 'request' | 'response'
): string {
  const suffix = direction === 'request' ? 'Request' : 'Response';
  return `aiserver.v1.${method}${suffix}`;
}
