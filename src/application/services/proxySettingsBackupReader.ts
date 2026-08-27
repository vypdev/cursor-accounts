import type { IProfileReader } from '../../domain/ports/IProfileReader';
import type {
  IProfileSettingsManager,
  ProxyBackupInfo,
} from '../../domain/ports/IProfileSettingsManager';
import type { IProxySettingsBackupReader } from '../../domain/ports/IProxySettingsBackupReader';

export interface ProxySettingsBackupReaderDependencies {
  profileReader: IProfileReader;
  profileSettingsManager: IProfileSettingsManager;
  debug(message: string): void;
}

/** Reads the temporary proxy backup state used by the Accounts panel. */
export class ProxySettingsBackupReader implements IProxySettingsBackupReader {
  constructor(
    private readonly dependencies: ProxySettingsBackupReaderDependencies
  ) {}

  async getAllProxyBackupInfo(): Promise<Map<string, ProxyBackupInfo>> {
    const profiles = await this.dependencies.profileReader.getProfiles();
    const infoMap = new Map<string, ProxyBackupInfo>();

    await Promise.all(
      profiles.map(async (profile) => {
        try {
          const info =
            await this.dependencies.profileSettingsManager.getProxyBackupInfo(
              profile.userDataDir
            );
          infoMap.set(profile.id, info);
        } catch (error) {
          this.dependencies.debug(
            `[ProxySettings] Failed to get backup info for ${profile.id}: ${formatError(error)}`
          );
        }
      })
    );

    return infoMap;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
