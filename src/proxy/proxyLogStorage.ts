import * as fs from 'fs/promises';
import * as path from 'path';
import { createWriteStream } from 'fs';
import type { WriteStream } from 'fs';
import { isNotFoundError } from '../utils/fileSystemErrors';

const LOG_FILE_PREFIX = 'proxy-';
const LOG_FILE_EXT = '.jsonl';

/**
 * Owns the append-only JSONL stream and bounded on-disk retention policy.
 *
 * Body formatting and traffic metadata deliberately stay outside this class;
 * this boundary only coordinates filesystem-backed log storage.
 */
export class ProxyLogStorage {
  private writeStream: WriteStream | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private totalBytesWritten = 0;

  constructor(
    private readonly logDir: string,
    private readonly maxTotalSizeBytes: number
  ) {}

  async initialize(): Promise<void> {
    await this.writeChain;
    await fs.mkdir(this.logDir, { recursive: true });
    await fs.mkdir(path.join(this.logDir, 'bodies'), { recursive: true });
    await this.rotateIfNeeded();
    this.openNewLogFile();
  }

  /** Queue a serialized JSONL write. */
  append(line: string): void {
    this.writeChain = this.writeChain.then(async () => {
      if (!this.writeStream) {
        this.openNewLogFile();
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
    await this.closeStream();
  }

  getLogDirectory(): string {
    return this.logDir;
  }

  private async closeStream(): Promise<void> {
    if (this.writeStream) {
      await new Promise<void>((resolve) => {
        this.writeStream?.end(() => resolve());
      });
      this.writeStream = null;
    }
  }

  private openNewLogFile(): void {
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `${LOG_FILE_PREFIX}${date}-${Date.now()}${LOG_FILE_EXT}`;
    const logPath = path.join(this.logDir, fileName);
    this.writeStream = createWriteStream(logPath, { flags: 'a' });
    this.totalBytesWritten = 0;
  }

  private async rotateIfNeeded(): Promise<void> {
    if (this.writeStream) {
      // This method is also called from the serialized write chain. Calling
      // close() here would await the chain currently executing and deadlock.
      await this.closeStream();
    }

    const files = await this.listLogFiles();
    let totalSize = await this.totalStorageBytes(files);

    while (totalSize > this.maxTotalSizeBytes && files.length > 0) {
      const oldest = files.shift();
      if (!oldest) {
        break;
      }
      const stat = await fs.stat(oldest);
      await fs.unlink(oldest);
      totalSize -= stat.size;
    }

    if (totalSize > this.maxTotalSizeBytes) {
      await this.pruneOldestBodyFiles(totalSize);
    }
  }

  private async totalStorageBytes(jsonlFiles: string[]): Promise<number> {
    const jsonlSizes = await Promise.all(
      jsonlFiles.map(async (file) => (await fs.stat(file)).size)
    );
    let totalSize = jsonlSizes.reduce((sum, size) => sum + size, 0);
    const bodiesDir = path.join(this.logDir, 'bodies');
    try {
      const bodyFiles = await fs.readdir(bodiesDir);
      const bodySizes = await Promise.all(
        bodyFiles.map(async (name) =>
          (await fs.stat(path.join(bodiesDir, name))).size
        )
      );
      totalSize += bodySizes.reduce((sum, size) => sum + size, 0);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
    return totalSize;
  }

  private async pruneOldestBodyFiles(currentTotal: number): Promise<void> {
    const bodiesDir = path.join(this.logDir, 'bodies');
    let entries: { path: string; mtime: number; size: number }[];
    try {
      const names = await fs.readdir(bodiesDir);
      entries = await Promise.all(
        names.map(async (name) => {
          const filePath = path.join(bodiesDir, name);
          const stat = await fs.stat(filePath);
          return { path: filePath, mtime: stat.mtimeMs, size: stat.size };
        })
      );
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      return;
    }
    entries.sort(
      (a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path)
    );
    let total = currentTotal;
    for (const entry of entries) {
      if (total <= this.maxTotalSizeBytes) {
        break;
      }
      await fs.unlink(entry.path);
      total -= entry.size;
    }
  }

  private async listLogFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.logDir);
      const paths = entries
        .filter((entry) =>
          entry.startsWith(LOG_FILE_PREFIX) && entry.endsWith(LOG_FILE_EXT)
        )
        .map((entry) => path.join(this.logDir, entry));
      const withStats = await Promise.all(
        paths.map(async (filePath) => ({
          path: filePath,
          mtime: (await fs.stat(filePath)).mtimeMs,
        }))
      );
      withStats.sort(
        (a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path)
      );
      return withStats.map((entry) => entry.path);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      return [];
    }
  }
}
