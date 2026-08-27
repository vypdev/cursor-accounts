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

    await this.applyProxyEffects(profileId, updates, previousProfile, profile);

    return profile;
  }

  private async applyProxyEffects(
    profileId: string,
    updates: Partial<Profile>,
    previousProfile: Profile | undefined,
    profile: Profile
  ): Promise<void> {
    if (updates.proxyEnabled === false) {
      await this.stopDisabledProfile(profileId);
      return;
    }

    if (updates.proxyEnabled === true) {
      await this.ensureCurrentProfile(profileId, profile);
      return;
    }

    if (this.hasJsonlLoggingChanged(updates, previousProfile, profile)) {
      await this.restartRunningProfile(profileId, profile);
    }
  }

  private async stopDisabledProfile(profileId: string): Promise<void> {
    await this.dependencies.proxyLifecycle.stop(profileId, {
      restoreSettings: true,
    });
  }

  private async ensureCurrentProfile(
    profileId: string,
    profile: Profile
  ): Promise<void> {
    const currentProfile =
      await this.dependencies.profileDetector.detectCurrentProfile();
    if (currentProfile?.id !== profileId || !isProfileProxyEnabled(profile)) {
      return;
    }

    await this.dependencies.proxyLifecycle.ensureProfileProxy(profileId);
  }

  private hasJsonlLoggingChanged(
    updates: Partial<Profile>,
    previousProfile: Profile | undefined,
    profile: Profile
  ): boolean {
    return (
      'proxyJsonlLoggingEnabled' in updates &&
      previousProfile != null &&
      isProfileProxyJsonlLoggingEnabled(previousProfile) !==
        isProfileProxyJsonlLoggingEnabled(profile)
    );
  }

  private async restartRunningProfile(
    profileId: string,
    profile: Profile
  ): Promise<void> {
    if (!isProfileProxyEnabled(profile)) {
      return;
    }

    if (await this.dependencies.proxyLifecycle.isRunning(profileId)) {
      await this.dependencies.proxyLifecycle.restartProfileProxy(profileId);
    }
  }
}
