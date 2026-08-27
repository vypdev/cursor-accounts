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

type ProfileProxyEditAction = 'stop' | 'ensure' | 'restart' | 'none';

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
    const action = await this.resolveAction(
      profileId,
      updates,
      previousProfile,
      profile
    );

    if (action === 'stop') {
      await this.dependencies.proxyLifecycle.stop(profileId, {
        restoreSettings: true,
      });
    } else if (action === 'ensure') {
      await this.dependencies.proxyLifecycle.ensureProfileProxy(profileId);
    } else if (action === 'restart') {
      await this.dependencies.proxyLifecycle.restartProfileProxy(profileId);
    }
  }

  private async resolveAction(
    profileId: string,
    updates: Partial<Profile>,
    previousProfile: Profile | undefined,
    profile: Profile
  ): Promise<ProfileProxyEditAction> {
    if (updates.proxyEnabled === false) {
      return 'stop';
    }

    if (updates.proxyEnabled === true) {
      const currentProfile =
        await this.dependencies.profileDetector.detectCurrentProfile();
      return currentProfile?.id === profileId && isProfileProxyEnabled(profile)
        ? 'ensure'
        : 'none';
    }

    if (
      !hasJsonlLoggingChanged(updates, previousProfile, profile) ||
      !isProfileProxyEnabled(profile)
    ) {
      return 'none';
    }

    return (await this.dependencies.proxyLifecycle.isRunning(profileId))
      ? 'restart'
      : 'none';
  }
}

function hasJsonlLoggingChanged(
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
