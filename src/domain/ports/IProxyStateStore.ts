import type { ProxyStateFile } from '@cursor-accounts/types';

/** Port for reading/writing shared proxy state across Cursor windows. */
export interface IProxyStateStore {
  read(): Promise<ProxyStateFile | null>;
  write(state: ProxyStateFile): Promise<void>;
  clear(): Promise<void>;
}
