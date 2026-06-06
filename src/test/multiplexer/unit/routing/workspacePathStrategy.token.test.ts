import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Session } from '../../../../domain/entities/Session';
import type { IProfileManager } from '../../../../domain/ports/IProfileManager';
import { WorkspacePathStrategy } from '../../../../proxy/multiplexer/routing/workspacePathStrategy';
import { InMemorySessionStore } from '../../../../proxy/multiplexer/storage/inMemorySessionStore';
import { UpstreamPool } from '../../../../proxy/multiplexer/upstreams/upstreamPool';

const BIDI_URL = '/aiserver.v1.BidiService/BidiAppend';

function createMockJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    .toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

function createProfileManager(): IProfileManager {
  return {
    initialize: async () => undefined,
    getProfiles: async () => [],
    getProfile: async (id) => ({ id, email: 'user@example.com' } as never),
    findProfileByEmail: async (email) =>
      email === 'user@example.com'
        ? ({ id: 'profile-123', email } as never)
        : undefined,
    findProfileByPath: async () => undefined,
    createProfile: async () => {
      throw new Error('not implemented');
    },
    updateProfile: async () => {
      throw new Error('not implemented');
    },
    deleteProfile: async () => undefined,
    validateEmail: () => ({ valid: true, errors: [] }),
    isProfilePathValid: async () => true,
    backup: async () => '/tmp/backup',
    getStats: async () => ({
      totalProfiles: 1,
      profilesWithTheme: 0,
      averageAge: 0,
    }),
  };
}

describe('WorkspacePathStrategy token extraction', () => {
  it('extracts profileId from Authorization header', async () => {
    let callbackProfileId: string | undefined;
    let callbackWorkspace: string | undefined;

    const store = new InMemorySessionStore();
    const pool = new UpstreamPool();
    const strategy = new WorkspacePathStrategy(
      {
        extractWorkspacePath: async () => '/workspace/project',
      },
      store,
      async (profileId, workspacePath) => {
        callbackProfileId = profileId;
        callbackWorkspace = workspacePath;
        await pool.createUpstream({
          id: 'profile-123-upstream',
          host: '127.0.0.1',
          port: 8100,
          metadata: { profileId, workspacePath },
        });
        return 'profile-123-upstream';
      },
      pool,
      createProfileManager()
    );

    const token = createMockJwt({ email: 'user@example.com' });
    const decision = await strategy.selectUpstream(
      new Session('127.0.0.1', 54321),
      [],
      {
        method: 'POST',
        url: BIDI_URL,
        payload: new Uint8Array([1, 2, 3]),
        headers: { authorization: `Bearer ${token}` },
      }
    );

    assert.equal(callbackProfileId, 'profile-123');
    assert.equal(callbackWorkspace, '/workspace/project');
    assert.equal(decision.upstream.id, 'profile-123-upstream');
  });

  it('returns null profile when email is unknown', async () => {
    const strategy = new WorkspacePathStrategy(
      { extractWorkspacePath: async () => null },
      new InMemorySessionStore(),
      undefined,
      undefined,
      createProfileManager()
    );

    const token = createMockJwt({ email: 'unknown@example.com' });
    const result = await strategy.extractProfileIdFromToken(`Bearer ${token}`);

    assert.equal(result.email, 'unknown@example.com');
    assert.equal(result.profileId, null);
  });
});
