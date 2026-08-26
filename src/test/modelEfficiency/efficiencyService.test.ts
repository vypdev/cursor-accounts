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
import type { EfficiencyOutputPresenter, EfficiencyPoller } from '../../modelEfficiency/efficiencyPorts';

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

  it('initializes an enabled poller after loading persisted stats', async () => {
    const profile = makeProfile({ efficiencyAnalysisEnabled: true });
    let loadedProfiles: Profile[] | undefined;
    const lifecycle: string[] = [];
    const poller: EfficiencyPoller = {
      start: () => lifecycle.push('start'),
      stop: () => lifecycle.push('stop'),
      resetState: async () => {
        lifecycle.push('reset');
      },
    };
    let created = 0;
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
      { getCachedQuota: () => undefined } as never,
      {
        createPoller: () => {
          created += 1;
          return poller;
        },
      }
    );

    await service.initialize();

    assert.deepEqual(loadedProfiles, [profile]);
    assert.equal(created, 1);
    assert.deepEqual(lifecycle, ['start']);
    service.dispose();
    assert.deepEqual(lifecycle, ['start', 'stop']);
  });

  it('resets a newly created poller before enabling analysis', async () => {
    const disabledProfile = makeProfile({ efficiencyAnalysisEnabled: false });
    const enabledProfile = {
      ...disabledProfile,
      efficiencyAnalysisEnabled: true,
    };
    const lifecycle: string[] = [];
    const poller: EfficiencyPoller = {
      start: () => lifecycle.push('start'),
      stop: () => lifecycle.push('stop'),
      resetState: async () => {
        lifecycle.push('reset');
      },
    };
    let currentProfiles: Profile[] = [disabledProfile];
    let updated: Profile | undefined;
    const service = new EfficiencyService(
      createContext(),
      {
        getProfiles: async () => currentProfiles,
        getProfile: async () => disabledProfile,
        updateProfile: async () => {
          updated = enabledProfile;
          currentProfiles = [enabledProfile];
          return enabledProfile;
        },
      } as never,
      { detectCurrentProfile: async () => disabledProfile } as never,
      { readTokens: async () => ({ accessToken: 'access-token' }) },
      createMockEfficiencyStatsStorage(),
      { getCachedQuota: () => undefined } as never,
      {
        apiKeyStore: {
          createApiKey: async () => 'api-key',
          getApiKey: async () => undefined,
          deleteApiKey: async () => {},
        },
        outputPresenter: createMockOutputPresenter(),
        createPoller: () => poller,
        requestActivationConsent: async () => true,
      }
    );

    const result = await service.setEfficiencyEnabled(
      disabledProfile.id,
      true
    );

    assert.equal(updated?.efficiencyAnalysisEnabled, true);
    assert.equal(result.profile, enabledProfile);
    assert.deepEqual(lifecycle, ['reset', 'start']);
    service.dispose();
  });

  it('restarts the detector with a fresh poller and notifies the user', async () => {
    const profile = makeProfile({ efficiencyAnalysisEnabled: true });
    const lifecycle: string[] = [];
    const pollers: EfficiencyPoller[] = [
      {
        start: () => lifecycle.push('start-1'),
        stop: () => lifecycle.push('stop-1'),
        resetState: async () => {
          lifecycle.push('reset-1');
        },
      },
      {
        start: () => lifecycle.push('start-2'),
        stop: () => lifecycle.push('stop-2'),
        resetState: async () => {
          lifecycle.push('reset-2');
        },
      },
    ];
    let pollerIndex = 0;
    const notifications: unknown[][] = [];
    (
      vscode.window as unknown as {
        showInformationMessage: (...args: unknown[]) => Promise<undefined>;
      }
    ).showInformationMessage = async (...args) => {
      notifications.push(args);
      return undefined;
    };
    const service = new EfficiencyService(
      createContext(),
      {
        getProfiles: async () => [profile],
        getProfile: async () => profile,
        updateProfile: async () => profile,
      } as never,
      { detectCurrentProfile: async () => profile } as never,
      { readTokens: async () => null },
      createMockEfficiencyStatsStorage(),
      { getCachedQuota: () => undefined } as never,
      {
        outputPresenter: createMockOutputPresenter(),
        createPoller: () => pollers[pollerIndex++]!,
      }
    );

    await service.initialize();
    await service.restartPromptDetector();

    assert.deepEqual(lifecycle, ['start-1', 'reset-1', 'stop-1', 'start-2']);
    assert.equal(notifications.length, 1);
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

function createMockOutputPresenter(): EfficiencyOutputPresenter {
  return {
    dispose: () => {},
    show: () => {},
    appendStatus: () => {},
    presentError: () => {},
    present: () => {},
  };
}
