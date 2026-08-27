import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import {
  ProxyProfileLifecycleUseCase,
  type ProxyProfileLifecycleUseCaseDependencies,
} from '../application/services/proxyProfileLifecycleUseCase';

describe('ProxyProfileLifecycleUseCase', () => {
  it('starts an enabled profile with the complete profile set', async () => {
    const calls: string[] = [];
    const profiles = [profile('profile-1', true), profile('profile-2', false)];
    const useCase = createUseCase(profiles, {
      ensureSharedProxy: async (receivedProfiles) => {
        calls.push(`ensure:${receivedProfiles.map(({ id }) => id).join(',')}`);
        return { success: true, port: 8080 };
      },
    });

    assert.deepEqual(await useCase.start('profile-1'), {
      success: true,
      port: 8080,
    });
    assert.deepEqual(calls, ['ensure:profile-1,profile-2']);
  });

  it('distinguishes a missing profile from a disabled profile on start', async () => {
    const useCase = createUseCase([profile('disabled', false)]);

    assert.deepEqual(await useCase.start('missing'), {
      success: false,
      error: 'Profile missing not found',
    });
    assert.deepEqual(await useCase.start('disabled'), {
      success: false,
      error: 'Proxy is disabled for this profile',
    });
  });

  it('returns the disabled result for a missing profile on ensure', async () => {
    const useCase = createUseCase([]);

    assert.deepEqual(await useCase.ensureProfileProxy('missing'), {
      success: false,
      error: 'Proxy is disabled for this profile',
    });
  });

  it('does not stop an already stopped profile during restart', async () => {
    const calls: string[] = [];
    const useCase = createUseCase([profile('profile-1', true)], {
      isRunning: async () => false,
      stop: async () => {
        calls.push('stop');
      },
      logInfo: () => calls.push('log'),
    });

    assert.deepEqual(await useCase.restart('profile-1'), { success: true });
    assert.deepEqual(calls, []);
  });

  it('stops without restoring settings and starts again for a running profile', async () => {
    const calls: string[] = [];
    const useCase = createUseCase([profile('profile-1', true)], {
      ensureSharedProxy: async () => {
        calls.push('ensure');
        return { success: true, port: 8080 };
      },
      isRunning: async () => true,
      stop: async (_profileId, options) => {
        calls.push(`stop:${String(options?.restoreSettings)}`);
      },
      logInfo: (message) => calls.push(message),
    });

    assert.deepEqual(await useCase.restart('profile-1'), {
      success: true,
      port: 8080,
    });
    assert.deepEqual(calls, [
      '[Proxy:profile-1] Restarting proxy after JSONL logging change',
      'stop:false',
      'ensure',
    ]);
  });

  it('reports a missing profile before checking whether it is running', async () => {
    let isRunningCalled = false;
    const useCase = createUseCase([], {
      isRunning: async () => {
        isRunningCalled = true;
        return true;
      },
    });

    assert.deepEqual(await useCase.restart('missing'), {
      success: false,
      error: 'Profile missing not found',
    });
    assert.equal(isRunningCalled, false);
  });
});

function createUseCase(
  profiles: ReturnType<typeof profile>[],
  overrides: Partial<ProxyProfileLifecycleUseCaseDependencies> = {}
) {
  const profileReader: IProfileReader = {
    getProfile: async (id) => profiles.find((candidate) => candidate.id === id),
    getProfiles: async () => profiles,
    findProfileByEmail: async () => undefined,
    findProfileByPath: async () => undefined,
  };

  return new ProxyProfileLifecycleUseCase({
    profileReader,
    ensureSharedProxy: async () => ({ success: true, port: 8080 }),
    isRunning: async () => false,
    stop: async () => {},
    logInfo: () => {},
    ...overrides,
  });
}

function profile(id: string, proxyEnabled: boolean) {
  return {
    id,
    email: `${id}@example.com`,
    slug: id,
    displayName: id,
    userDataDir: `/tmp/${id}`,
    created: '2024-01-01T00:00:00.000Z',
    proxyEnabled,
  };
}
