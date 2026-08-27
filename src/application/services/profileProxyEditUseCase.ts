import {
  isProfileProxyEnabled,
  isProfileProxyJsonlLoggingEnabled,
  type Profile,
} from '@cursor-accounts/types';
import type { IProfileDetector } from '../../domain/ports/IProfileDetector';
import type { IProfileWriter } from '../../domain/ports/IProfileWriter';
import type { IProxyLifecycle } from '../../domain/ports/IProxyLifecycle';

export interface ProfileProxyEditUseCaseDependencies {
  profileWriter: Pick<IProfileWriter, 'getProfile' | 'updateProfile'>;
  profileDetector: Pick<IProfileDetector, 'detectCurrentProfile'>;
  proxyLifecycle: Pick<
    IProxyLifecycle,
    'stop' | 'ensureProfileProxy' | 'isRunning' | 'restartProfileProxy'
  >;
}

/**
 * Applies profile edits that have runtime proxy side effects.
 *
 * Profile persistence and proxy lifecycle changes are intentionally kept in
 * one application boundary so UI adapters only report the outcome.
 */
export class ProfileProxyEditUseCase {
  constructor(
    private readonly dependencies: ProfileProxyEditUseCaseDependencies
  ) {}

  async execute(profileId: string, updates: Partial<Profile>): Promise<Profile> {
    const previousProfile = await this.dependencies.profileWriter.getProfile(
      profileId
    );
    const profile = await this.dependencies.profileWriter.updateProfile(
      profileId,
      updates
    );

    const jsonlLoggingChanged =
      'proxyJsonlLoggingEnabled' in updates &&
      previousProfile != null &&
      isProfileProxyJsonlLoggingEnabled(previousProfile) !==
        isProfileProxyJsonlLoggingEnabled(profile);

    if (updates.proxyEnabled === false) {
      await this.dependencies.proxyLifecycle.stop(profileId, {
        restoreSettings: true,
      });
    } else if (updates.proxyEnabled === true) {
      const currentProfile =
        await this.dependencies.profileDetector.detectCurrentProfile();
      if (
        currentProfile?.id === profileId &&
        isProfileProxyEnabled(profile)
      ) {
        await this.dependencies.proxyLifecycle.ensureProfileProxy(profileId);
      }
    } else if (
      jsonlLoggingChanged &&
      isProfileProxyEnabled(profile) &&
      (await this.dependencies.proxyLifecycle.isRunning(profileId))
    ) {
      await this.dependencies.proxyLifecycle.restartProfileProxy(profileId);
    }

    return profile;
  }
}
