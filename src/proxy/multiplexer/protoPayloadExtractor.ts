import { fileURLToPath } from 'node:url';
import type { IProtoPayloadExtractor } from '../../domain/ports/IProtoPayloadExtractor';
import { decodeProtoEntry } from '../proxyDecode';
import type { ProxyLogEntry } from '../types';

const BIDI_APPEND_PATH = '/aiserver.v1.BidiService/BidiAppend';

function normalizeWorkspacePath(uri: string): string {
  if (uri.startsWith('file://')) {
    try {
      return fileURLToPath(uri);
    } catch {
      return decodeURIComponent(uri.slice(7));
    }
  }
  return uri;
}

function workspaceFromDecoded(
  decoded: Record<string, unknown> | undefined
): string | null {
  if (!decoded) {
    return null;
  }

  const workspaceUris = decoded.workspace_uris ?? decoded.workspaceUris;
  if (Array.isArray(workspaceUris) && workspaceUris.length > 0) {
    const first = workspaceUris[0];
    if (typeof first === 'string') {
      return normalizeWorkspacePath(first);
    }
  }

  const workspaceRoot =
    decoded.workspace_root_path ??
    decoded.workspaceRootPath ??
    decoded.workspace_project_dir ??
    decoded.workspaceProjectDir;

  if (typeof workspaceRoot === 'string' && workspaceRoot.length > 0) {
    return normalizeWorkspacePath(workspaceRoot);
  }

  return null;
}

/**
 * Extracts workspace path from Cursor protobuf using existing decode pipeline.
 */
export class ProtoPayloadExtractor implements IProtoPayloadExtractor {
  async extractWorkspacePath(
    payload: Uint8Array,
    url?: string,
    method?: string
  ): Promise<string | null> {
    if (method !== 'POST' || !url?.includes(BIDI_APPEND_PATH)) {
      return null;
    }

    try {
      const entry: ProxyLogEntry = {
        timestamp: new Date().toISOString(),
        direction: 'request',
        method: method ?? 'POST',
        url: url.startsWith('http') ? url : `https://api2.cursor.sh${url}`,
        host: 'api2.cursor.sh',
        headers: { 'content-type': 'application/connect+proto' },
        bodyBase64: Buffer.from(payload).toString('base64'),
        bodyEncoding: 'base64',
        bodyRawBytes: payload.byteLength,
        isConnectRpc: true,
        isCursorHost: true,
      };

      const result = await decodeProtoEntry(entry);
      return workspaceFromDecoded(result.decoded);
    } catch {
      return null;
    }
  }
}
