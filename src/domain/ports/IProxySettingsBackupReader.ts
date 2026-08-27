import type { ProxyBackupInfo } from './IProfileSettingsManager';

/** Port for reading the proxy backup state of all managed profiles. */
export interface IProxySettingsBackupReader {
  getAllProxyBackupInfo(): Promise<Map<string, ProxyBackupInfo>>;
}
