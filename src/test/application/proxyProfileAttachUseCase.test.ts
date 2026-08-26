import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile, ProxyStateFile } from '@cursor-accounts/types';
import type { IProfileReader } from '../../domain/ports/IProfileReader';
import {
  ProxyProfileAttachUseCase,
  type ProxyProfileAttachUseCaseDependencies,
} from '../../application/services/proxyProfileAttachUseCase';

const PROFILE: Profile = {
  id: 'profile-1',
  email: 'profile-1@example.com',
  slug: 'profile-1',
  displayName: 'Profile 1',
  userDataDir: '/tmp/profile-1',
  proxyEnabled: true,
  created: '2026-01-01T00:00:00.000Z',
};

const STATE: ProxyStateFile = {
  version: 1,
  profileId: PROFILE.id,
  running: true,
  port: 8080,
  apiPort: 18_080,
  apiToken: 'a'.repeat(64),
  pid: 123,
  lastUpdatedAt: '2026-01-01T00:00:00.000Z',
};

function createDependencies(
  overrides: Partial<ProxyProfileAttachUseCaseDependencies> = {}
): ProxyProfileAttachUseCaseDependencies & {
  events: string[];
  warnings: string[];
} {
  const events: string[] = [];
  const warnings: string[] = [];
  const dependencies: ProxyProfileAttachUseCaseDependencies = {
    profileManager: {
      getProfile: async () => PROFILE,
    } as unknown as IProfileReader,
    stateStore: {
      read: async () => STATE,
      clear: async () => {
        events.push('clear-profile-state');
      },
      write: async () => undefined,
    },
    sharedStateStore: {
      read: async () => null,
      clear: async () => {
        events.push('clear-shared-state');
      },
      write: async () => undefined,
    },
    sharedRuntimeId: '__shared__',
    createApiClient: () => ({
      getStatus: async () => ({ running: true }),
    }),
    resolveApiPort: (_mitmPort, persistedApiPort) => persistedApiPort ?? 18_080,
    ensureAgentTracking: async () => {
      events.push('tracking');
    },
    applyProxySettings: async () => {
      events.push('apply-settings');
    },
    ensureTrafficIngress: async (profileId) => {
      events.push(`ensure-ingress:${profileId}`);
    },
    warn: (message) => warnings.push(message),
    notifyStatusChange: () => {
      events.push('status-change');
    },
    ...overrides,
  };

  return Object.assign(dependencies, { events, warnings });
}

describe('ProxyProfileAttachUseCase', () => {
  it('attaches to a healthy persisted profile runtime', async () => {
    const dependencies = createDependencies();

    await new ProxyProfileAttachUseCase(dependencies).execute(PROFILE.id);

    assert.deepEqual(dependencies.events, [
      'tracking',
      'apply-settings',
      'ensure-ingress:profile-1',
      'status-change',
    ]);
  });

  it('clears a failed shared record before falling back to a profile runtime', async () => {
    const statuses: Array<boolean | Error> = [
      new Error('shared API unavailable'),
      true,
    ];
    const dependencies = createDependencies({
      sharedStateStore: {
        read: async () => ({ ...STATE, profileId: '__shared__' }),
        clear: async () => {
          dependencies.events.push('clear-shared-state');
        },
        write: async () => undefined,
      },
      createApiClient: () => ({
        getStatus: async () => {
          const status = statuses.shift();
          if (status instanceof Error) {
            throw status;
          }
          return { running: status ?? false };
        },
      }),
    });

    await new ProxyProfileAttachUseCase(dependencies).execute(PROFILE.id);

    assert.deepEqual(dependencies.events, [
      'clear-shared-state',
      'tracking',
      'apply-settings',
      'ensure-ingress:profile-1',
      'status-change',
    ]);
  });

  it('clears a profile record when its control API is no longer running', async () => {
    const dependencies = createDependencies({
      createApiClient: () => ({
        getStatus: async () => ({ running: false }),
      }),
    });

    await new ProxyProfileAttachUseCase(dependencies).execute(PROFILE.id);

    assert.deepEqual(dependencies.events, ['clear-profile-state']);
    assert.deepEqual(dependencies.warnings, []);
  });

  it('continues attachment when tracking initialization fails', async () => {
    const dependencies = createDependencies({
      ensureAgentTracking: async () => {
        throw new Error('tracking unavailable');
      },
    });

    await new ProxyProfileAttachUseCase(dependencies).execute(PROFILE.id);

    assert.deepEqual(dependencies.events, [
      'apply-settings',
      'ensure-ingress:profile-1',
      'status-change',
    ]);
    assert.equal(dependencies.warnings.length, 1);
    assert.match(dependencies.warnings[0] ?? '', /tracking unavailable/);
  });

  it('does not touch persisted state for a disabled profile', async () => {
    let readCount = 0;
    const dependencies = createDependencies({
      profileManager: {
        getProfile: async () => ({ ...PROFILE, proxyEnabled: false }),
      } as unknown as IProfileReader,
      stateStore: {
        read: async () => {
          readCount += 1;
          return STATE;
        },
        clear: async () => undefined,
        write: async () => undefined,
      },
    });

    await new ProxyProfileAttachUseCase(dependencies).execute(PROFILE.id);

    assert.equal(readCount, 0);
    assert.deepEqual(dependencies.events, []);
  });
});
