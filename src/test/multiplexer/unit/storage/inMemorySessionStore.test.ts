import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Session } from '../../../../domain/entities/Session';
import { InMemorySessionStore } from '../../../../proxy/multiplexer/storage/inMemorySessionStore';

describe('InMemorySessionStore', () => {
  it('stores and retrieves session bindings', () => {
    const store = new InMemorySessionStore();
    const session = new Session('127.0.0.1', 54321);
    const assignedAt = new Date();

    store.set({
      sessionKey: session.key,
      upstreamId: 'u1',
      assignedAt,
      workspacePath: '/workspace/a',
    });

    const binding = store.get(session);
    assert.equal(binding?.upstreamId, 'u1');
    assert.equal(binding?.workspacePath, '/workspace/a');
  });

  it('resolves workspace mapping without full session binding', () => {
    const store = new InMemorySessionStore();
    store.setWorkspaceMapping('/workspace/b', 'u2');

    const binding = store.getByWorkspace('/workspace/b');
    assert.equal(binding?.upstreamId, 'u2');
    assert.equal(binding?.workspacePath, '/workspace/b');
  });

  it('deletes session and workspace mapping', () => {
    const store = new InMemorySessionStore();
    const session = new Session('127.0.0.1', 54321);
    store.set({
      sessionKey: session.key,
      upstreamId: 'u1',
      assignedAt: new Date(),
      workspacePath: '/workspace/c',
    });

    store.delete(session);
    assert.equal(store.get(session), undefined);
    assert.equal(store.getByWorkspace('/workspace/c'), undefined);
  });

  it('lists all session bindings', () => {
    const store = new InMemorySessionStore();
    store.set({
      sessionKey: '127.0.0.1:1',
      upstreamId: 'u1',
      assignedAt: new Date(),
    });
    store.set({
      sessionKey: '127.0.0.1:2',
      upstreamId: 'u2',
      assignedAt: new Date(),
    });

    assert.equal(store.list().length, 2);
  });

  it('clears expired sessions', () => {
    const store = new InMemorySessionStore();
    const oldDate = new Date(Date.now() - 10_000);
    const recentDate = new Date();

    store.set({
      sessionKey: '127.0.0.1:1',
      upstreamId: 'u1',
      assignedAt: oldDate,
      workspacePath: '/old',
    });
    store.set({
      sessionKey: '127.0.0.1:2',
      upstreamId: 'u2',
      assignedAt: recentDate,
    });

    const removed = store.clearExpired(new Date(Date.now() - 5_000));
    assert.equal(removed, 1);
    assert.equal(store.get(Session.fromKey('127.0.0.1:1')), undefined);
    assert.equal(store.get(Session.fromKey('127.0.0.1:2'))?.upstreamId, 'u2');
  });
});
