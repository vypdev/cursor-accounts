import type { ProfileConfig } from '@cursor-accounts/types';

/** Persistence port for profile configuration. */
export interface IProfileStorage {
  getConfigPath(): string;
  exists(): Promise<boolean>;
  load(): Promise<ProfileConfig>;
  save(config: ProfileConfig): Promise<void>;
  backup(): Promise<string>;
  restore(backupPath: string): Promise<void>;
  clearCache(): void;
}
