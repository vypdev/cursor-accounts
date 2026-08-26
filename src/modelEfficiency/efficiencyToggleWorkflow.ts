import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileWriter } from '../domain/ports/IProfileWriter';
import type { Profile } from '../profiles/types';
import { t } from '../l10n';
import { ApiKeyManagerError } from './apiKeyManager';
import type { EfficiencyApiKeyStore } from './efficiencyPorts';
import type { EfficiencyStatsStorage } from './efficiencyStatsStorage';

export interface EfficiencyToggleWorkflowDependencies {
  profileWriter: IProfileWriter;
  profileDetector: IProfileDetector;
  authReader: IProfileAuthReader;
  apiKeyStore: EfficiencyApiKeyStore;
  statsStorage: Pick<EfficiencyStatsStorage, 'loadStats' | 'deleteStats'>;
  requestActivationConsent: () => Promise<boolean>;
}

export interface EfficiencyToggleResult {
  profile: Profile;
  message: string;
}

export function getEfficiencyWrongWindowMessage(): string {
  return t('errors.efficiencyWrongWindow');
}

/** Applies the profile-level efficiency toggle without owning poller lifecycle. */
export class EfficiencyToggleWorkflow {
  constructor(
    private readonly dependencies: EfficiencyToggleWorkflowDependencies
  ) {}

  async execute(
    profileId: string,
    enabled: boolean
  ): Promise<EfficiencyToggleResult> {
    const profile = await this.resolveCurrentProfile(profileId);
    if (enabled) {
      return this.enable(profile);
    }
    return this.disable(profile);
  }

  private async resolveCurrentProfile(profileId: string): Promise<Profile> {
    const current = await this.dependencies.profileDetector.detectCurrentProfile();
    if (!current || current.id !== profileId) {
      throw new Error(getEfficiencyWrongWindowMessage());
    }

    const profile = await this.dependencies.profileWriter.getProfile(profileId);
    if (!profile) {
      throw new Error(t('errors.profileNotFound'));
    }
    return profile;
  }

  private async enable(profile: Profile): Promise<EfficiencyToggleResult> {
    const consentGranted = await this.dependencies.requestActivationConsent();
    if (!consentGranted) {
      throw new Error(t('errors.efficiencyActivationCancelled'));
    }

    const auth = await this.dependencies.authReader.readTokens(
      profile.userDataDir
    );
    if (!auth?.accessToken) {
      throw new Error(t('errors.noAccessToken'));
    }

    try {
      await this.dependencies.apiKeyStore.createApiKey(
        profile.id,
        auth.accessToken
      );
    } catch (error) {
      if (error instanceof ApiKeyManagerError) {
        throw new Error(error.message);
      }
      throw error;
    }

    const updated = await this.dependencies.profileWriter.updateProfile(
      profile.id,
      { efficiencyAnalysisEnabled: true }
    );
    await this.dependencies.statsStorage.loadStats(updated);

    return {
      profile: updated,
      message: t('efficiency.activated', { name: profile.displayName }),
    };
  }

  private async disable(profile: Profile): Promise<EfficiencyToggleResult> {
    await this.dependencies.apiKeyStore.deleteApiKey(profile.id);
    await this.dependencies.statsStorage.deleteStats(profile);
    const updated = await this.dependencies.profileWriter.updateProfile(
      profile.id,
      { efficiencyAnalysisEnabled: false }
    );

    return {
      profile: updated,
      message: t('efficiency.deactivated', { name: profile.displayName }),
    };
  }
}
