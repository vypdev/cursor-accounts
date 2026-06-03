import * as fs from 'fs/promises';
import * as path from 'path';
import type { ProxyStateFile } from '@cursor-accounts/types';
import { z } from 'zod';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import {
  PROXY_STATE_FILE_NAME,
  PROXY_STATE_SCHEMA_VERSION,
} from './types';

const proxyStateSchema = z.object({
  version: z.number(),
  running: z.boolean(),
  port: z.number().optional(),
  pid: z.number().optional(),
  startedAt: z.string().optional(),
  caCertificatePath: z.string().optional(),
  lastUpdatedAt: z.string(),
});

export class ProxyStateFileStoreError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProxyStateFileStoreError';
  }
}

/**
 * Persists shared proxy state for multi-window visibility.
 */
export class ProxyStateFileStore implements IProxyStateStore {
  private readonly statePath: string;

  constructor(globalStoragePath: string) {
    this.statePath = path.join(globalStoragePath, PROXY_STATE_FILE_NAME);
  }

  getStatePath(): string {
    return this.statePath;
  }

  async read(): Promise<ProxyStateFile | null> {
    try {
      const content = await fs.readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;
      const result = proxyStateSchema.safeParse(parsed);
      if (!result.success) {
        return null;
      }
      return result.data;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return null;
      }
      return null;
    }
  }

  async write(state: ProxyStateFile): Promise<void> {
    const validated = proxyStateSchema.parse({
      ...state,
      version: state.version ?? PROXY_STATE_SCHEMA_VERSION,
    });

    await fs.mkdir(path.dirname(this.statePath), { recursive: true });

    const tempPath = `${this.statePath}.${process.pid}.tmp`;
    const content = JSON.stringify(validated, null, 2);

    try {
      await fs.writeFile(tempPath, content, { encoding: 'utf-8', mode: 0o600 });
      await fs.rename(tempPath, this.statePath);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // ignore cleanup failure
      }
      throw new ProxyStateFileStoreError(
        'Failed to write proxy state file',
        error instanceof Error ? error : undefined
      );
    }
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.statePath);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return;
      }
      throw new ProxyStateFileStoreError(
        'Failed to clear proxy state file',
        error instanceof Error ? error : undefined
      );
    }
  }
}
