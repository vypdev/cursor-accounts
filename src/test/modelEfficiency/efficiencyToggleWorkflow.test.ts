import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProfileAuthReader } from '../../domain/ports/IProfileAuthReader';
import type { IProfileDetector } from '../../domain/ports/IProfileDetector';
import type { IProfileWriter } from '../../domain/ports/IProfileWriter';
import { ApiKeyManagerError } from '../../modelEfficiency/apiKeyManager';
import {
  EfficiencyToggleWorkflow,
  getEfficiencyWrongWindowMessage,
} from '../../modelEfficiency/efficiencyToggleWorkflow';
import type { EfficiencyApiKeyStore } from '../../modelEfficiency/efficiencyPorts';
import type { EfficiencyStatsStorage } from '../../modelEfficiency/efficiencyStatsStorage';
import type { Profile } from '../../profiles/types';

describe('EfficiencyToggleWorkflow', () => {
  it('enables analysis after consent and persists the updated profile', async () => {
    const profile = makeProfile();
    const updatedProfile = {
      ...profile,
      efficiencyAnalysisEnabled: true,
    };
    const events: string[] = [];
    const workflow = createWorkflow({
      profile,
      requestActivationConsent: async () => true,
      authReader: { readTokens: async () => ({ accessToken: 'access-token' }) },
      apiKeyStore: {
        createApiKey: async (_profileId, accessToken) => {
          assert.equal(accessToken, 'access-token');
          events.push('create-key');
          return 'api-key';
        },
        getApiKey: async () => undefined,
        deleteApiKey: async () => {},
      },
      statsStorage: {
        loadStats: async (target) => {
          assert.equal(target, updatedProfile);
          events.push('load-stats');
          return undefined;
        },
        deleteStats: async () => {},
      },
      updateProfile: async () => {
        events.push('update-profile');
        return updatedProfile;
      },
    });

    const result = await workflow.execute(profile.id, true);

    assert.equal(result.profile, updatedProfile);
    assert.equal(result.message, 'Model efficiency analysis enabled for Profile A');
    assert.deepEqual(events, ['create-key', 'update-profile', 'load-stats']);
  });

  it('converts API-key failures to the public workflow error', async () => {
    const profile = makeProfile();
    let updated = false;
    const workflow = createWorkflow({
      profile,
      requestActivationConsent: async () => true,
      authReader: { readTokens: async () => ({ accessToken: 'access-token' }) },
      apiKeyStore: {
        createApiKey: async () => {
          throw new ApiKeyManagerError('provider rejected the request', 403);
        },
        getApiKey: async () => undefined,
        deleteApiKey: async () => {},
      },
      updateProfile: async () => {
        updated = true;
        return profile;
      },
    });

    await assert.rejects(
      () => workflow.execute(profile.id, true),
      (error: Error) => {
        assert.equal(error.message, 'provider rejected the request');
        return true;
      }
    );
    assert.equal(updated, false);
  });

  it('disables analysis by removing credentials and stats before updating the profile', async () => {
    const profile = makeProfile({ efficiencyAnalysisEnabled: true });
    const updatedProfile = {
      ...profile,
      efficiencyAnalysisEnabled: false,
    };
    const events: string[] = [];
    const workflow = createWorkflow({
      profile,
      apiKeyStore: {
        createApiKey: async () => 'api-key',
        getApiKey: async () => undefined,
        deleteApiKey: async () => {
          events.push('delete-key');
        },
      },
      statsStorage: {
        loadStats: async () => undefined,
        deleteStats: async (target) => {
          assert.equal(target, profile);
          events.push('delete-stats');
        },
      },
      updateProfile: async () => {
        events.push('update-profile');
        return updatedProfile;
      },
    });

    const result = await workflow.execute(profile.id, false);

    assert.equal(result.profile, updatedProfile);
    assert.deepEqual(events, ['delete-key', 'delete-stats', 'update-profile']);
  });

  it('rejects operations for a profile that is not active in the window', async () => {
    const profile = makeProfile();
    const workflow = createWorkflow({
      profile,
      currentProfile: undefined,
    });

    await assert.rejects(
      () => workflow.execute(profile.id, false),
      (error: Error) => {
        assert.equal(error.message, getEfficiencyWrongWindowMessage());
        return true;
      }
    );
  });
});

interface WorkflowOverrides {
  profile: Profile;
  currentProfile?: Profile;
  requestActivationConsent?: () => Promise<boolean>;
  authReader?: IProfileAuthReader;
  apiKeyStore?: EfficiencyApiKeyStore;
  statsStorage?: Pick<EfficiencyStatsStorage, 'loadStats' | 'deleteStats'>;
  updateProfile?: (id: string, updates: Partial<Profile>) => Promise<Profile>;
}

function createWorkflow(overrides: WorkflowOverrides): EfficiencyToggleWorkflow {
  const currentProfile =
    'currentProfile' in overrides
      ? overrides.currentProfile
      : overrides.profile;
  const profileWriter: IProfileWriter = {
    getProfiles: async () => [overrides.profile],
    getProfile: async () => overrides.profile,
    findProfileByEmail: async () => undefined,
    findProfileByPath: async () => undefined,
    updateProfile:
      overrides.updateProfile ?? (async () => overrides.profile),
  };
  const profileDetector = {
    detectCurrentProfile: async () => currentProfile ?? null,
  } as unknown as IProfileDetector;
  const authReader =
    overrides.authReader ?? ({ readTokens: async () => null } as IProfileAuthReader);
  const apiKeyStore =
    overrides.apiKeyStore ??
    ({
      createApiKey: async () => 'api-key',
      getApiKey: async () => undefined,
      deleteApiKey: async () => {},
    } satisfies EfficiencyApiKeyStore);
  const statsStorage =
    overrides.statsStorage ??
    ({
      loadStats: async () => undefined,
      deleteStats: async () => {},
    } satisfies Pick<EfficiencyStatsStorage, 'loadStats' | 'deleteStats'>);

  return new EfficiencyToggleWorkflow({
    profileWriter,
    profileDetector,
    authReader,
    apiKeyStore,
    statsStorage,
    requestActivationConsent:
      overrides.requestActivationConsent ?? (async () => false),
  });
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-a',
    email: 'a@example.com',
    slug: 'a-example-com',
    displayName: 'Profile A',
    userDataDir: '/home/user/.cursor-a',
    created: new Date().toISOString(),
    ...overrides,
  };
}
