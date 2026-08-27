import { captureBodyForLog } from './bodyCapture';
import { ProxyLogStorage } from './proxyLogStorage';
import { DEFAULT_MAX_BODY_LOG_BYTES, type ProxyLogEntry } from './types';
import {
  isConnectRpcContentType,
  isCursorHost,
  normalizeHeaders,
} from './utils/proxyRequestMetadata';

export interface RequestLoggerOptions {
  maxBodyLogBytes?: number;
  spillLargeBodies?: boolean;
}

/**
 * Append-only JSON Lines logger for intercepted proxy traffic.
 */
export class RequestLogger {
  private readonly storage: ProxyLogStorage;
  private readonly maxBodyLogBytes: number;
  private readonly spillLargeBodies: boolean;

  constructor(
    private readonly logDir: string,
    maxTotalSizeBytes: number,
    options: RequestLoggerOptions = {}
  ) {
    this.storage = new ProxyLogStorage(logDir, maxTotalSizeBytes);
    this.maxBodyLogBytes = options.maxBodyLogBytes ?? DEFAULT_MAX_BODY_LOG_BYTES;
    this.spillLargeBodies = options.spillLargeBodies !== false;
  }

  async initialize(): Promise<void> {
    await this.storage.initialize();
  }

  /**
   * Queue a log entry (serialized writes).
   */
  log(entry: ProxyLogEntry): void {
    this.storage.append(`${JSON.stringify(entry)}\n`);
  }

  async close(): Promise<void> {
    await this.storage.close();
  }

  getLogDirectory(): string {
    return this.storage.getLogDirectory();
  }

  formatBody(
    body: Buffer | string | undefined,
    contentType?: string,
    spillKey?: string
  ): ReturnType<typeof captureBodyForLog> {
    return captureBodyForLog(body, contentType, {
      maxInlineBytes: this.maxBodyLogBytes,
      spillLargeBodies: this.spillLargeBodies,
      redactJsonFields: true,
      logDir: this.logDir,
      spillKey,
    });
  }

  /** @deprecated Use instance formatBody for spill support */
  static formatBody(
    body: Buffer | string | undefined,
    contentType?: string
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
