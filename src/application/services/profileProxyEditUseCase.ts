import type { Profile } from '@cursor-accounts/types';
import type { IProfileWriter } from '../../domain/ports/IProfileWriter';
import type { ProfileProxyEditLifecycleService } from './profileProxyEditLifecycleService';

export interface ProfileProxyEditUseCaseDependencies {
  profileWriter: Pick<IProfileWriter, 'getProfile' | 'updateProfile'>;
  profileProxyEditLifecycle: Pick<ProfileProxyEditLifecycleService, 'apply'>;
}

/**
 * Applies profile edits that have runtime proxy side effects.
 *
 * Profile persistence and proxy lifecycle changes are intentionally kept in
 * one application workflow so UI adapters only report the outcome.
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

    await this.dependencies.profileProxyEditLifecycle.apply(
      profileId,
      updates,
      previousProfile,
      profile
    );

    return profile;
  }
}
