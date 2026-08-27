import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import type { ProxyStateFile } from '@cursor-accounts/types';
import { z } from 'zod';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import { isNotFoundError } from '../utils/fileSystemErrors';
import {
  PROXY_STATE_FILE_NAME,
  PROXY_STATE_SCHEMA_VERSION,
} from './types';

const proxyStateSchema = z.object({
  version: z.number(),
  profileId: z.string(),
  running: z.boolean(),
  port: z.number().optional(),
  apiPort: z.number().optional(),
  apiToken: z.string().min(32).optional(),
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
 * Persists per-profile proxy state in each profile's userDataDir.
 */
export class ProxyStateFileStore implements IProxyStateStore {
  getStatePath(userDataDir: string): string {
    return path.join(userDataDir, PROXY_STATE_FILE_NAME);
  }

  async read(userDataDir: string): Promise<ProxyStateFile | null> {
    const statePath = this.getStatePath(userDataDir);
    try {
      const content = await fs.readFile(statePath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;
      const result = proxyStateSchema.safeParse(parsed);
      if (!result.success) {
        return null;
      }
      return result.data;
    } catch {
      return null;
    }
  }

  async write(userDataDir: string, state: ProxyStateFile): Promise<void> {
    const validated = proxyStateSchema.parse({
      ...state,
      version: state.version ?? PROXY_STATE_SCHEMA_VERSION,
    });

    const statePath = this.getStatePath(userDataDir);
    const tempPath = createTempStatePath(statePath);
    const content = JSON.stringify(validated, null, 2);

    try {
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(tempPath, content, { encoding: 'utf-8', mode: 0o600 });
      await fs.rename(tempPath, statePath);
    } catch (error) {
      await removeTempStateFile(tempPath);
      throw new ProxyStateFileStoreError(
        'Failed to write proxy state file',
        error instanceof Error ? error : undefined
      );
    }
  }

  async clear(userDataDir: string): Promise<void> {
    const statePath = this.getStatePath(userDataDir);
    try {
      await fs.unlink(statePath);
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }
      throw new ProxyStateFileStoreError(
        'Failed to clear proxy state file',
        error instanceof Error ? error : undefined
      );
    }
  }
}

function createTempStatePath(statePath: string): string {
  return `${statePath}.${process.pid}.${randomUUID()}.tmp`;
}

async function removeTempStateFile(tempPath: string): Promise<void> {
  try {
    await fs.unlink(tempPath);
  } catch {
    // A failed cleanup must not hide the original persistence error.
  }
}
