import {
  isProfileProxyEnabled,
  type Profile,
} from '@cursor-accounts/types';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import { decodeJwtPayload } from '../auth/tokenReader';
import { getEfficiencyDbPath } from '../persistence/efficiencyDatabase';
import * as extensionLog from '../logging/extensionLog';

export interface ProxyProfileRoutingConfigurationDependencies {
  authReader?: IProfileAuthReader;
}

/** Builds the identity and database maps consumed by a shared proxy runtime. */
export class ProxyProfileRoutingConfiguration {
  constructor(
    private readonly dependencies: ProxyProfileRoutingConfigurationDependencies
  ) {}

  async buildUserIdMapping(
    profiles: Profile[]
  ): Promise<Map<string, string>> {
    const mapping = new Map<string, string>();
    const authReader = this.dependencies.authReader;
    if (!authReader) {
      return mapping;
    }

    for (const profile of profiles) {
      if (!isProfileProxyEnabled(profile)) {
        continue;
      }
      try {
        const tokens = await authReader.readTokens(profile.userDataDir);
        if (!tokens?.accessToken) {
          continue;
        }
        const payload = decodeJwtPayload(tokens.accessToken);
        const sub = payload?.sub;
        if (typeof sub !== 'string' || !sub) {
          continue;
        }
        const userId = sub.includes('|') ? sub.split('|').pop()! : sub;
        mapping.set(userId, profile.id);
        extensionLog.info(
          `[Proxy] Mapped user ${userId.slice(0, 8)}… → profile ${profile.displayName}`
        );
      } catch (error) {
        extensionLog.warn(
          `[Proxy] Failed to map user for profile ${profile.displayName}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return mapping;
  }

  buildProfileDbPaths(profiles: Profile[]): Record<string, string> {
    const profileDbPaths: Record<string, string> = {};
    for (const profile of profiles) {
      if (isProfileProxyEnabled(profile)) {
        profileDbPaths[profile.id] = getEfficiencyDbPath(profile.userDataDir);
      }
    }
    return profileDbPaths;
  }
}
