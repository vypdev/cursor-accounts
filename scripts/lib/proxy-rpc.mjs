/**
 * Shared Connect-RPC parsing for proxy log scripts.
 */

/** Pathname: /{package.Service}/{Method} */
export const CONNECT_RPC_PATH_RE =
  /\/((?:aiserver|agent)\.v1\.[A-Za-z0-9_]+)\/([A-Za-z0-9_]+)/;

/** Legacy aiserver-only pattern (deprecated). */
export const AISERVER_RPC_PATH_RE =
  /\/(aiserver\.v1\.[A-Za-z0-9_]+Service)\/([A-Za-z0-9_]+)/;

/** RPC name/path fragments that indicate interactive agent or chat traffic. */
export const INTERACTIVE_RPC_MARKERS = [
  {
    id: 'composer',
    label: 'Composer / legacy chat streams (api2)',
    test: (path) =>
      /StreamComposer|StreamChat|StreamConversation|StreamChatContext|StreamComposerContext/.test(
        path
      ),
  },
  {
    id: 'agent-api5',
    label: 'AgentService on api5 (HTTP/2)',
    test: (path) =>
      /\/agent\.v1\.AgentService\/(Run|RunSSE)$/.test(path) ||
      path.includes('agent.api5'),
  },
  {
    id: 'agent-bidi',
    label: 'Agent bidi / poll on api2 (HTTP/1)',
    test: (path) =>
      /\/agent\.v1\.AgentService\/RunPoll/.test(path) ||
      /BidiAppend|BidiPoll|StreamBidiPoll|StreamBidi/.test(path),
  },
];

/**
 * @param {string | undefined} url
 * @returns {string | null} e.g. /agent.v1.AgentService/RunPoll
 */
export function parseConnectRpcPath(url) {
  const raw = String(url ?? '');
  try {
    const pathname = new URL(raw).pathname;
    if (
      /(?:aiserver|agent)\.v1\./.test(pathname) &&
      pathname.includes('Service/')
    ) {
      return pathname;
    }
  } catch {
    const m = raw.match(CONNECT_RPC_PATH_RE);
    if (m) {
      return `/${m[1]}/${m[2]}`;
    }
  }
  return null;
}

/**
 * @param {string} rpcPath
 */
export function isInteractiveRpcPath(rpcPath) {
  return INTERACTIVE_RPC_MARKERS.some((m) => m.test(rpcPath));
}

/**
 * @param {import('protobufjs').Root} root
 * @param {typeof import('protobufjs').Service} ServiceCtor
 * @returns {Map<string, { requestType: import('protobufjs').Type, responseType: import('protobufjs').Type }>}
 */
export function buildRpcTypeMap(root, ServiceCtor) {
  /** @type {Map<string, { requestType: import('protobufjs').Type, responseType: import('protobufjs').Type }>} */
  const map = new Map();

  /** @param {{ nestedArray: unknown[] }} obj */
  const visit = (obj) => {
    for (const item of obj.nestedArray) {
      if (item instanceof ServiceCtor) {
        const svc = item;
        for (const method of svc.methodsArray) {
          const serviceName = String(svc.fullName).replace(/^\./, '');
          const rpcPath = `/${serviceName}/${method.name}`;
          try {
            map.set(rpcPath, {
              requestType: root.lookupType(method.requestType),
              responseType: root.lookupType(method.responseType),
            });
          } catch {
            // unresolved types in generated proto
          }
        }
      }
      if (
        item &&
        typeof item === 'object' &&
        'nestedArray' in item &&
        Array.isArray(item.nestedArray)
      ) {
        visit(item);
      }
    }
  };

  visit(root);
  return map;
}

/**
 * @param {string} rpcPath
 * @param {'request' | 'response'} direction
 * @param {Map<string, { requestType: import('protobufjs').Type, responseType: import('protobufjs').Type }>} rpcMap
 * @returns {import('protobufjs').Type | undefined}
 */
export function resolveRpcMessageType(rpcPath, direction, rpcMap) {
  const types = rpcMap.get(rpcPath);
  if (!types) {
    return undefined;
  }
  return direction === 'request' ? types.requestType : types.responseType;
}
