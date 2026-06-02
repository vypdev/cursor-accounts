import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getEfficiencyWrongWindowMessage,
  EfficiencyService,
} from '../../modelEfficiency/efficiencyService';
import { createMockEfficiencyStatsStorage } from './mockEfficiencyStatsStorage';
import type { Profile } from '../../profiles/types';

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

    const service = new EfficiencyService(
      context,
      profileManager as never,
      profileDetector as never,
      authReader,
      createMockEfficiencyStatsStorage()
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

    const service = new EfficiencyService(
      context,
      profileManager as never,
      profileDetector as never,
      authReader,
      createMockEfficiencyStatsStorage()
    );

    await assert.rejects(
      () => service.setEfficiencyEnabled('profile-b', false),
      (error: Error) => {
        assert.equal(error.message, getEfficiencyWrongWindowMessage());
        return true;
      }
    );
  });
});
