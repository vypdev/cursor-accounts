import * as fs from 'fs/promises';
import * as path from 'path';
import type { ProxyStateFile } from '@cursor-accounts/types';
import type { ISharedProxyStateStore } from '../domain/ports/ISharedProxyStateStore';

export type { ISharedProxyStateStore } from '../domain/ports/ISharedProxyStateStore';

/** Persists the ownership record used to attach to a shared proxy process. */
export class SharedProxyStateStore implements ISharedProxyStateStore {
  constructor(private readonly statePath: string) {}

  async read(): Promise<ProxyStateFile | null> {
    try {
      const content = await fs.readFile(this.statePath, 'utf-8');
      return JSON.parse(content) as ProxyStateFile;
    } catch {
      return null;
    }
  }

  async write(state: ProxyStateFile): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.statePath);
    } catch {
      // Clearing an already absent state is intentionally idempotent.
    }
  }
}
