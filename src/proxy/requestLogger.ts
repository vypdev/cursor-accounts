import * as fs from 'fs/promises';
import * as path from 'path';
import { createWriteStream } from 'fs';
import type { WriteStream } from 'fs';
import { formatBodyForLog } from './bodyFormat';
import {
  CONNECT_RPC_CONTENT_TYPE,
  CURSOR_HOST_SUFFIXES,
  type ProxyLogEntry,
} from './types';

const LOG_FILE_PREFIX = 'proxy-';
const LOG_FILE_EXT = '.jsonl';

/**
 * Append-only JSON Lines logger for intercepted proxy traffic.
 */
export class RequestLogger {
  private writeStream: WriteStream | null = null;
  private currentLogPath: string | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private totalBytesWritten = 0;

  constructor(
    private readonly logDir: string,
    private readonly maxTotalSizeBytes: number
  ) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });
    await this.rotateIfNeeded();
    await this.openNewLogFile();
  }

  /**
   * Queue a log entry (serialized writes).
   */
  log(entry: ProxyLogEntry): void {
    const line = `${JSON.stringify(entry)}\n`;
    this.writeChain = this.writeChain.then(async () => {
      if (!this.writeStream) {
        await this.openNewLogFile();
      }
      await new Promise<void>((resolve, reject) => {
        if (!this.writeStream) {
          resolve();
          return;
        }
        this.writeStream.write(line, (err) => {
          if (err) {
            reject(err);
          } else {
            this.totalBytesWritten += Buffer.byteLength(line, 'utf8');
            resolve();
          }
        });
      });
      if (this.totalBytesWritten >= this.maxTotalSizeBytes) {
        await this.rotateIfNeeded();
      }
    });
  }

  async close(): Promise<void> {
    await this.writeChain;
    if (this.writeStream) {
      await new Promise<void>((resolve) => {
        this.writeStream?.end(() => resolve());
      });
      this.writeStream = null;
    }
  }

  getLogDirectory(): string {
    return this.logDir;
  }

  static formatBody(
    body: Buffer | string | undefined,
    contentType?: string
  ): ReturnType<typeof formatBodyForLog> {
    return formatBodyForLog(body, contentType);
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
    return contentType.toLowerCase().includes(CONNECT_RPC_CONTENT_TYPE);
  }

  static isCursorHost(host: string): boolean {
    const lower = host.toLowerCase();
    return CURSOR_HOST_SUFFIXES.some(
      (suffix) => lower === suffix || lower.endsWith(`.${suffix}`)
    );
  }

  private async openNewLogFile(): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `${LOG_FILE_PREFIX}${date}-${Date.now()}${LOG_FILE_EXT}`;
    this.currentLogPath = path.join(this.logDir, fileName);
    this.writeStream = createWriteStream(this.currentLogPath, { flags: 'a' });
    this.totalBytesWritten = 0;
  }

  private async rotateIfNeeded(): Promise<void> {
    if (this.writeStream) {
      await this.close();
    }

    const files = await this.listLogFiles();
    let totalSize = 0;
    for (const file of files) {
      const stat = await fs.stat(file);
      totalSize += stat.size;
    }

    while (totalSize > this.maxTotalSizeBytes && files.length > 0) {
      const oldest = files.shift();
      if (!oldest) {
        break;
      }
      const stat = await fs.stat(oldest);
      await fs.unlink(oldest);
      totalSize -= stat.size;
    }
  }

  private async listLogFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.logDir);
      const paths = entries
        .filter((e) => e.startsWith(LOG_FILE_PREFIX) && e.endsWith(LOG_FILE_EXT))
        .map((e) => path.join(this.logDir, e));
      const withStats = await Promise.all(
        paths.map(async (p) => ({
          path: p,
          mtime: (await fs.stat(p)).mtimeMs,
        }))
      );
      withStats.sort((a, b) => a.mtime - b.mtime);
      return withStats.map((x) => x.path);
    } catch {
      return [];
    }
  }
}
