import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Session } from '../../../../domain/entities/Session';
import { Upstream } from '../../../../domain/entities/Upstream';
import type { IProtoPayloadExtractor } from '../../../../domain/ports/IProtoPayloadExtractor';
import { WorkspacePathStrategy } from '../../../../proxy/multiplexer/routing/workspacePathStrategy';
import { InMemorySessionStore } from '../../../../proxy/multiplexer/storage/inMemorySessionStore';
import { UpstreamPool } from '../../../../proxy/multiplexer/upstreams/upstreamPool';
import type { IProfileManager } from '../../../../domain/ports/IProfileManager';

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
    getProfile: async () => undefined,
    findProfileByEmail: async (email) =>
      email === 'user@example.com'
        ? ({ id: 'profile-a', email } as never)
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

function mockExtractor(path: string | null): IProtoPayloadExtractor {
  return {
    extractWorkspacePath: async () => path,
  };
}

describe('WorkspacePathStrategy', () => {
  it('routes same workspace path to same upstream', async () => {
    const store = new InMemorySessionStore();
    const pool = new UpstreamPool();
    await pool.createUpstream({
      id: 'u1',
      host: '127.0.0.1',
      port: 8080,
      metadata: {
        profileId: 'profile-a',
        workspacePath: '/Users/dev/project-a',
      },
    });
    await pool.createUpstream({
      id: 'u2',
      host: '127.0.0.1',
      port: 8081,
      metadata: { profileId: 'profile-a' },
    });

    const strategy = new WorkspacePathStrategy(
      mockExtractor('/Users/dev/project-a'),
      store,
      undefined,
      pool,
      createProfileManager()
    );
    const upstreams = pool.getAll();
    const token = createMockJwt({ email: 'user@example.com' });
    const context = {
      method: 'POST',
      url: BIDI_URL,
      payload: new Uint8Array([1, 2, 3]),
      headers: { authorization: `Bearer ${token}` },
    };

    const first = await strategy.selectUpstream(
      new Session('127.0.0.1', 54321),
      upstreams,
      context
    );
    const second = await strategy.selectUpstream(
      new Session('127.0.0.1', 54322),
      upstreams,
      context
    );

    assert.equal(first.reason, 'workspace-path-hit');
    assert.equal(second.reason, 'workspace-path-hit');
    assert.equal(first.upstream.id, second.upstream.id);
    assert.equal(first.metadata.workspacePath, '/Users/dev/project-a');
  });

  it('falls back to sticky session when workspace cannot be resolved', async () => {
    const store = new InMemorySessionStore();
    const strategy = new WorkspacePathStrategy(mockExtractor(null), store);
    const session = new Session('127.0.0.1', 54321);
    const upstreams = [new Upstream('u1', '127.0.0.1', 8080)];

    const decision = await strategy.selectUpstream(session, upstreams, {
      method: 'GET',
      url: '/other',
    });

    assert.equal(decision.reason, 'workspace-path-fallback');
    assert.equal(decision.upstream.id, 'u1');
  });

  it('reassigns workspace when mapped upstream becomes unavailable', async () => {
    const store = new InMemorySessionStore();
    const pool = new UpstreamPool();
    await pool.createUpstream({
      id: 'u1',
      host: '127.0.0.1',
      port: 8080,
      metadata: {
        profileId: 'profile-a',
        workspacePath: '/Users/dev/project-b',
      },
    });
    await pool.createUpstream({
      id: 'u2',
      host: '127.0.0.1',
      port: 8081,
      metadata: { profileId: 'profile-a' },
    });

    const strategy = new WorkspacePathStrategy(
      mockExtractor('/Users/dev/project-b'),
      store,
      undefined,
      pool,
      createProfileManager()
    );
    const token = createMockJwt({ email: 'user@example.com' });
    const context = {
      method: 'POST',
      url: BIDI_URL,
      payload: new Uint8Array([4, 5, 6]),
      headers: { authorization: `Bearer ${token}` },
    };

    const upstreams = pool.getAll();
    await strategy.selectUpstream(
      new Session('127.0.0.1', 54321),
      upstreams,
      context
    );
    pool.getById('u1')!.setHealth(false);

    const decision = await strategy.selectUpstream(
      new Session('127.0.0.1', 54322),
      pool.getHealthy(),
      context
    );

    assert.equal(decision.upstream.id, 'u2');
    assert.equal(decision.reason, 'workspace-path-new');
  });

  it('distributes new workspaces via round-robin', async () => {
    const store = new InMemorySessionStore();
    const pool = new UpstreamPool();
    for (const id of ['u1', 'u2', 'u3']) {
      await pool.createUpstream({
        id,
        host: '127.0.0.1',
        port: 8080 + Number(id[1]),
        metadata: { profileId: 'profile-a' },
      });
    }

    const strategy = new WorkspacePathStrategy(
      {
        extractWorkspacePath: async (_payload, _url, _method) =>
          `/workspace/${Math.random()}`,
      },
      store,
      undefined,
      pool,
      createProfileManager()
    );
    const token = createMockJwt({ email: 'user@example.com' });
    const context = {
      method: 'POST',
      url: BIDI_URL,
      payload: new Uint8Array([7, 8, 9]),
      headers: { authorization: `Bearer ${token}` },
    };

    const ids: string[] = [];
    for (let port = 54321; port < 54324; port++) {
      const decision = await strategy.selectUpstream(
        new Session('127.0.0.1', port),
        pool.getHealthy(),
        context
      );
      ids.push(decision.upstream.id);
    }

    assert.deepEqual(ids, ['u1', 'u2', 'u3']);
  });

  it('calls callback to create upstream when workspace not found', async () => {
    let callbackInvoked = false;
    const store = new InMemorySessionStore();
    const pool = new UpstreamPool();
    const strategy = new WorkspacePathStrategy(
      mockExtractor('/workspace/new'),
      store,
      async (profileId, workspacePath) => {
        callbackInvoked = true;
        assert.equal(profileId, 'profile-a');
        assert.equal(workspacePath, '/workspace/new');
        await pool.createUpstream({
          id: 'new-upstream',
          host: '127.0.0.1',
          port: 8100,
          metadata: { profileId, workspacePath },
        });
        return 'new-upstream';
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
        payload: new Uint8Array([1]),
        headers: { authorization: `Bearer ${token}` },
      }
    );

    assert.equal(callbackInvoked, true);
    assert.equal(decision.upstream.id, 'new-upstream');
  });

  it('ignores non-BidiAppend requests for workspace extraction', async () => {
    let called = false;
    const strategy = new WorkspacePathStrategy(
      {
        extractWorkspacePath: async () => {
          called = true;
          return '/should-not-be-used';
        },
      },
      new InMemorySessionStore()
    );

    await strategy.selectUpstream(
      new Session('127.0.0.1', 54321),
      [new Upstream('u1', '127.0.0.1', 8080)],
      { method: 'POST', url: '/other/path', payload: new Uint8Array([1]) }
    );

    assert.equal(called, false);
  });
});
