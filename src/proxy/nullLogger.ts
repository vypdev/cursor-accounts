import { captureBodyForLog } from './bodyCapture';
import {
  CONNECT_RPC_CONTENT_TYPE,
  CURSOR_HOST_SUFFIXES,
  DEFAULT_MAX_BODY_LOG_BYTES,
  type ProxyLogEntry,
} from './types';

/**
 * No-op traffic logger for production mode (no JSONL files written).
 */
export class NullLogger {
  async initialize(): Promise<void> {}

  log(_entry: ProxyLogEntry): void {}

  async close(): Promise<void> {}

  getLogDirectory(): string {
    return '';
  }

  formatBody(
    body: Buffer | string | undefined,
    contentType?: string,
    _spillKey?: string
  ): ReturnType<typeof captureBodyForLog> {
    return captureBodyForLog(body, contentType, {
      maxInlineBytes: DEFAULT_MAX_BODY_LOG_BYTES,
      spillLargeBodies: false,
    });
  }

  static normalizeHeaders(
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

  static isConnectRpcContentType(contentType: string | undefined): boolean {
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

  static isCursorHost(host: string): boolean {
    const lower = host.toLowerCase();
    return CURSOR_HOST_SUFFIXES.some(
      (suffix) => lower === suffix || lower.endsWith(`.${suffix}`)
    );
  }
}

export type ProxyTrafficLogger = Pick<
  import('./requestLogger').RequestLogger,
  'initialize' | 'log' | 'close' | 'formatBody' | 'getLogDirectory'
>;
