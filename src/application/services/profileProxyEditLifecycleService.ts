import {
  isProfileProxyEnabled,
  isProfileProxyJsonlLoggingEnabled,
  type Profile,
} from '@cursor-accounts/types';
import type { IProfileDetector } from '../../domain/ports/IProfileDetector';
import type { IProxyLifecycle } from '../../domain/ports/IProxyLifecycle';

export interface ProfileProxyEditLifecycleServiceDependencies {
  profileDetector: Pick<IProfileDetector, 'detectCurrentProfile'>;
  proxyLifecycle: Pick<
    IProxyLifecycle,
    'stop' | 'ensureProfileProxy' | 'isRunning' | 'restartProfileProxy'
  >;
}

/** Applies runtime proxy effects after a profile configuration edit. */
export class ProfileProxyEditLifecycleService {
  constructor(
    private readonly dependencies: ProfileProxyEditLifecycleServiceDependencies
  ) {}

  async apply(
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
