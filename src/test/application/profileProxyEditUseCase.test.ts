import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { Profile } from '../../profiles/types';
import type { IProxyLifecycle } from '../../domain/ports/IProxyLifecycle';
import { ProfileProxyEditUseCase } from '../../application/services/profileProxyEditUseCase';

const PROFILE: Profile = {
  id: 'p1',
  email: 'user@example.com',
  slug: 'user',
  displayName: 'User',
  userDataDir: '/tmp/cursor-user',
  created: '2024-01-01T00:00:00.000Z',
  proxyEnabled: true,
  proxyJsonlLoggingEnabled: false,
};

function createUseCase(options: {
  previousProfile?: Profile;
  updatedProfile?: Profile;
  currentProfile?: Profile | null;
  running?: boolean;
} = {}) {
  const previousProfile = options.previousProfile ?? PROFILE;
  const updatedProfile = options.updatedProfile ?? PROFILE;
  const stop = mock.fn(async () => undefined);
  const ensureProfileProxy = mock.fn(async () => ({
    success: true,
    port: 8080,
  }));
  const isRunning = mock.fn(async () => options.running ?? false);
  const restartProfileProxy = mock.fn(async () => ({
    success: true,
    port: 8080,
  }));
  const proxyLifecycle: Pick<
    IProxyLifecycle,
    'stop' | 'ensureProfileProxy' | 'isRunning' | 'restartProfileProxy'
  > = {
    stop,
    ensureProfileProxy,
    isRunning,
    restartProfileProxy,
  };
  const updateProfile = mock.fn(async () => updatedProfile);
  const useCase = new ProfileProxyEditUseCase({
    profileWriter: {
      getProfile: async () => previousProfile,
      updateProfile,
    },
    profileDetector: {
      detectCurrentProfile: async () => options.currentProfile ?? null,
    },
    proxyLifecycle,
  });

  return {
    useCase,
    updateProfile,
    stop,
    ensureProfileProxy,
    isRunning,
    restartProfileProxy,
  };
}

describe('ProfileProxyEditUseCase', () => {
  it('persists the edit and stops with explicit settings restoration when disabled', async () => {
    const fixture = createUseCase({
      updatedProfile: { ...PROFILE, proxyEnabled: false },
    });

    await fixture.useCase.execute('p1', { proxyEnabled: false });

    assert.deepEqual(fixture.updateProfile.mock.calls[0]?.arguments, [
      'p1',
      { proxyEnabled: false },
    ]);
    assert.deepEqual(fixture.stop.mock.calls[0]?.arguments, [
      'p1',
      { restoreSettings: true },
    ]);
    assert.equal(fixture.ensureProfileProxy.mock.callCount(), 0);
    assert.equal(fixture.restartProfileProxy.mock.callCount(), 0);
  });

  it('ensures the edited proxy when it is enabled for the current profile', async () => {
    const fixture = createUseCase({
      currentProfile: PROFILE,
    });

    await fixture.useCase.execute('p1', { proxyEnabled: true });

    assert.equal(fixture.ensureProfileProxy.mock.callCount(), 1);
    assert.deepEqual(fixture.ensureProfileProxy.mock.calls[0]?.arguments, [
      'p1',
    ]);
    assert.equal(fixture.stop.mock.callCount(), 0);
    assert.equal(fixture.restartProfileProxy.mock.callCount(), 0);
  });

  it('does not start a proxy for a profile that is not active in the current window', async () => {
    const fixture = createUseCase({
      currentProfile: { ...PROFILE, id: 'another-profile' },
    });

    await fixture.useCase.execute('p1', { proxyEnabled: true });

    assert.equal(fixture.ensureProfileProxy.mock.callCount(), 0);
  });

  it('restarts a running proxy when JSONL logging changes', async () => {
    const fixture = createUseCase({
      previousProfile: { ...PROFILE, proxyJsonlLoggingEnabled: false },
      updatedProfile: { ...PROFILE, proxyJsonlLoggingEnabled: true },
      running: true,
    });

    await fixture.useCase.execute('p1', {
      proxyJsonlLoggingEnabled: true,
    });

    assert.equal(fixture.isRunning.mock.callCount(), 1);
    assert.deepEqual(fixture.restartProfileProxy.mock.calls[0]?.arguments, [
      'p1',
    ]);
  });

  it('does not restart a proxy when the effective JSONL setting is unchanged', async () => {
    const fixture = createUseCase({
      previousProfile: { ...PROFILE, proxyJsonlLoggingEnabled: true },
      updatedProfile: { ...PROFILE, proxyJsonlLoggingEnabled: true },
      running: true,
    });

    await fixture.useCase.execute('p1', {
      proxyJsonlLoggingEnabled: true,
    });

    assert.equal(fixture.isRunning.mock.callCount(), 0);
    assert.equal(fixture.restartProfileProxy.mock.callCount(), 0);
  });
});
