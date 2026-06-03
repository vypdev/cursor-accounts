import type { ProxyStateFile } from '@cursor-accounts/types';

/** Port for reading/writing per-profile proxy state in userDataDir. */
export interface IProxyStateStore {
  read(userDataDir: string): Promise<ProxyStateFile | null>;
  write(userDataDir: string, state: ProxyStateFile): Promise<void>;
  clear(userDataDir: string): Promise<void>;
}
