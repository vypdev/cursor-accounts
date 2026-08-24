import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile } from '@cursor-accounts/types';
import type { IProfileAuthReader } from '../../domain/ports/IProfileAuthReader';
import { ProxyProfileRoutingConfiguration } from '../../services/proxyProfileRoutingConfiguration';

function profile(id: string, proxyEnabled = true): Profile {
  return {
    id,
    displayName: id,
    userDataDir: `/tmp/${id}`,
    proxyEnabled,
  } as Profile;
}

function token(sub: unknown): string {
  const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `header.${payload}.signature`;
}

describe('ProxyProfileRoutingConfiguration', () => {
  it('returns an empty user mapping when auth is unavailable', async () => {
    const configuration = new ProxyProfileRoutingConfiguration({});

    assert.deepEqual(
      await configuration.buildUserIdMapping([profile('profile-1')]),
      new Map()
    );
  });

  it('maps plain and namespaced JWT subjects for enabled profiles', async () => {
    const profiles = [profile('profile-1'), profile('profile-2')];
    const authReader: IProfileAuthReader = {
      readTokens: async (userDataDir) => ({
        accessToken:
          userDataDir.endsWith('profile-1')
            ? token('user-1')
            : token('auth0|user-2'),
      }),
    };
    const configuration = new ProxyProfileRoutingConfiguration({ authReader });

    assert.deepEqual(await configuration.buildUserIdMapping(profiles), new Map([
      ['user-1', 'profile-1'],
      ['user-2', 'profile-2'],
    ]));
  });

  it('skips disabled, missing, and malformed identity data', async () => {
    const profiles = [
      profile('disabled', false),
      profile('missing'),
      profile('malformed'),
      profile('empty-sub'),
    ];
    const authReader: IProfileAuthReader = {
      readTokens: async (userDataDir) => {
        if (userDataDir.endsWith('missing')) {
          return null;
        }
        if (userDataDir.endsWith('malformed')) {
          return { accessToken: 'not-a-jwt' };
        }
        return { accessToken: token('') };
      },
    };
    const configuration = new ProxyProfileRoutingConfiguration({ authReader });

    assert.deepEqual(await configuration.buildUserIdMapping(profiles), new Map());
  });

  it('builds database paths only for proxy-enabled profiles', () => {
    const configuration = new ProxyProfileRoutingConfiguration({});

    assert.deepEqual(
      configuration.buildProfileDbPaths([
        profile('enabled'),
        profile('disabled', false),
      ]),
      { enabled: '/tmp/enabled/User/globalStorage/cursor-accounts-efficiency.db' }
    );
  });
});
