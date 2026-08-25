import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import {
  getEfficiencyWrongWindowMessage,
  EfficiencyService,
} from '../../modelEfficiency/efficiencyService';
import { t } from '../../l10n';
import { createMockEfficiencyStatsStorage } from './mockEfficiencyStatsStorage';
import type { Profile } from '../../profiles/types';

const originalShowInformationMessage = (
  vscode.window as unknown as {
    showInformationMessage?: (...args: unknown[]) => unknown;
  }
).showInformationMessage;

afterEach(() => {
  (
    vscode.window as unknown as {
      showInformationMessage?: (...args: unknown[]) => unknown;
    }
  ).showInformationMessage = originalShowInformationMessage;
});

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

describe('EfficiencyService.setEfficiencyEnabled', () => {
  it('does not create credentials when activation consent is cancelled', async () => {
    let authRead = false;
    (
      vscode.window as unknown as {
        showInformationMessage: (...args: unknown[]) => Promise<undefined>;
      }
    ).showInformationMessage = async () => undefined;
    const profile = makeProfile();
    const service = new EfficiencyService(
      createContext(),
      {
        getProfile: async () => profile,
        getProfiles: async () => [profile],
        updateProfile: async () => profile,
      } as never,
      { detectCurrentProfile: async () => profile } as never,
      {
        readTokens: async () => {
          authRead = true;
          return { accessToken: 'token' };
        },
      },
      createMockEfficiencyStatsStorage(),
      { getCachedQuota: () => undefined } as never
    );

    await assert.rejects(() => service.setEfficiencyEnabled(profile.id, true));
    assert.equal(authRead, false);
    service.dispose();
  });

  it('rejects activation when the current profile has no access token', async () => {
    (
      vscode.window as unknown as {
        showInformationMessage: (...args: unknown[]) => Promise<{ title: string }>;
      }
    ).showInformationMessage = async () => ({
      title: t('efficiency.consent.confirm'),
    });
    const profile = makeProfile();
    const service = new EfficiencyService(
      createContext(),
      {
        getProfile: async () => profile,
        getProfiles: async () => [profile],
        updateProfile: async () => profile,
      } as never,
      { detectCurrentProfile: async () => profile } as never,
      { readTokens: async () => null },
      createMockEfficiencyStatsStorage(),
      { getCachedQuota: () => undefined } as never
    );

    await assert.rejects(() => service.setEfficiencyEnabled(profile.id, true));
    service.dispose();
  });

  it('rejects toggle when profile is not the current window', async () => {
    const profileA = makeProfile({ id: 'profile-a' });
    const profileB = makeProfile({
      id: 'profile-b',
      email: 'b@example.com',
      slug: 'b-example-com',
      displayName: 'Profile B',
      userDataDir: '/home/user/.cursor-b',
    });

    const profileManager = {
      getProfile: async (id: string) =>
        id === 'profile-b' ? profileB : profileA,
      getProfiles: async () => [profileA, profileB],
      updateProfile: async () => profileB,
    };

    const profileDetector = {
      detectCurrentProfile: async () => profileA,
      getCurrentUserDataDir: () => profileA.userDataDir,
    };

    const context = {
      extensionPath: '/tmp/ext',
      secrets: {
        store: async () => {},
        get: async () => undefined,
        delete: async () => {},
      },
      globalState: {
        get: () => undefined,
        update: async () => {},
      },
    } as unknown as import('vscode').ExtensionContext;

    const authReader = {
      readTokens: async () => null,
    };

    const multiProfileQuotaService = {
      getCachedQuota: () => undefined,
    };

    const service = new EfficiencyService(
      context,
      profileManager as never,
      profileDetector as never,
      authReader,
      createMockEfficiencyStatsStorage(),
      multiProfileQuotaService as never
    );

    await assert.rejects(
      () => service.setEfficiencyEnabled('profile-b', true),
      (error: Error) => {
        assert.equal(error.message, getEfficiencyWrongWindowMessage());
        return true;
      }
    );
  });

  it('rejects toggle when no managed profile matches this window', async () => {
    const profileB = makeProfile({ id: 'profile-b' });

    const profileManager = {
      getProfile: async (id: string) =>
        id === 'profile-b' ? profileB : undefined,
      getProfiles: async () => [profileB],
      updateProfile: async () => profileB,
    };

    const profileDetector = {
      detectCurrentProfile: async () => null,
      getCurrentUserDataDir: () => '/default/cursor',
    };

    const context = {
      extensionPath: '/tmp/ext',
      secrets: {
        store: async () => {},
        get: async () => undefined,
        delete: async () => {},
      },
      globalState: {
        get: () => undefined,
        update: async () => {},
      },
    } as unknown as import('vscode').ExtensionContext;

    const authReader = {
      readTokens: async () => null,
    };

    const multiProfileQuotaService = {
      getCachedQuota: () => undefined,
    };

    const service = new EfficiencyService(
      context,
      profileManager as never,
      profileDetector as never,
      authReader,
      createMockEfficiencyStatsStorage(),
      multiProfileQuotaService as never
    );

    await assert.rejects(
      () => service.setEfficiencyEnabled('profile-b', false),
      (error: Error) => {
        assert.equal(error.message, getEfficiencyWrongWindowMessage());
        return true;
      }
    );
  });

  it('rejects a toggle when the current profile was removed', async () => {
    const profile = makeProfile();
    const context = createContext();
    const profileDetector = {
      detectCurrentProfile: async () => profile,
      getCurrentUserDataDir: () => profile.userDataDir,
    };
    const service = new EfficiencyService(
      context,
      {
        getProfile: async () => undefined,
        getProfiles: async () => [],
        updateProfile: async () => profile,
      } as never,
      profileDetector as never,
      { readTokens: async () => null },
      createMockEfficiencyStatsStorage(),
      { getCachedQuota: () => undefined } as never
    );

    await assert.rejects(
      () => service.setEfficiencyEnabled(profile.id, false),
      (error: Error) => {
        assert.equal(error.message, 'Profile not found');
        return true;
      }
    );
  });

  it('initializes persisted stats without starting a poller for disabled profiles', async () => {
    const profile = makeProfile({ efficiencyAnalysisEnabled: false });
    let loadedProfiles: Profile[] = [];
    const statsStorage = {
      ...createMockEfficiencyStatsStorage(),
      loadAllStats: async (profiles: Profile[]) => {
        loadedProfiles = profiles;
        return new Map();
      },
    } as never;
    const service = new EfficiencyService(
      createContext(),
      {
        getProfiles: async () => [profile],
        getProfile: async () => profile,
        updateProfile: async () => profile,
      } as never,
      {
        detectCurrentProfile: async () => profile,
        getCurrentUserDataDir: () => profile.userDataDir,
      } as never,
      { readTokens: async () => null },
      statsStorage,
      { getCachedQuota: () => undefined } as never
    );

    await service.initialize();
    assert.deepEqual(loadedProfiles, [profile]);
    service.dispose();
  });

  it('disables analysis, removes the API key, and deletes stored stats', async () => {
    const profile = makeProfile({ efficiencyAnalysisEnabled: true });
    let deletedStatsFor: Profile | undefined;
    let updatedProfile: Profile | undefined;
    const statsStorage = {
      ...createMockEfficiencyStatsStorage(),
      deleteStats: async (target: Profile) => {
        deletedStatsFor = target;
      },
    } as never;
    let deletedSecret = false;
    const service = new EfficiencyService(
      createContext({
        delete: async () => {
          deletedSecret = true;
        },
      }),
      {
        getProfiles: async () => [
          { ...profile, efficiencyAnalysisEnabled: false },
        ],
        getProfile: async () => profile,
        updateProfile: async (_id: string, updates: Partial<Profile>) => {
          updatedProfile = { ...profile, ...updates };
          return updatedProfile;
        },
      } as never,
      {
        detectCurrentProfile: async () => profile,
        getCurrentUserDataDir: () => profile.userDataDir,
      } as never,
      { readTokens: async () => null },
      statsStorage,
      { getCachedQuota: () => undefined } as never
    );

    const result = await service.setEfficiencyEnabled(profile.id, false);

    assert.equal(deletedSecret, true);
    assert.equal(deletedStatsFor, profile);
    assert.equal(updatedProfile?.efficiencyAnalysisEnabled, false);
    assert.equal(result.profile.efficiencyAnalysisEnabled, false);
  });
});

function createContext(overrides: { delete?: () => Promise<void> } = {}) {
  return {
    extensionPath: '/tmp/ext',
    secrets: {
      store: async () => {},
      get: async () => undefined,
      delete: overrides.delete ?? (async () => {}),
    },
    globalState: {
      get: () => undefined,
      update: async () => {},
    },
  } as unknown as import('vscode').ExtensionContext;
}
