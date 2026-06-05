import { captureBodyForLog } from './bodyCapture';
import { DEFAULT_MAX_BODY_LOG_BYTES, type ProxyLogEntry } from './types';
import {
  isConnectRpcContentType,
  isCursorHost,
  normalizeHeaders,
} from './utils/proxyRequestMetadata';

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

  static normalizeHeaders = normalizeHeaders;
  static isConnectRpcContentType = isConnectRpcContentType;
  static isCursorHost = isCursorHost;
}

export type ProxyTrafficLogger = Pick<
  import('./requestLogger').RequestLogger,
  'initialize' | 'log' | 'close' | 'formatBody' | 'getLogDirectory'
>;
