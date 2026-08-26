import type { ProxyStateFile } from '@cursor-accounts/types';

/** Port for the ownership record shared by extension windows. */
export interface ISharedProxyStateStore {
  read(): Promise<ProxyStateFile | null>;
  write(state: ProxyStateFile): Promise<void>;
  clear(): Promise<void>;
}
