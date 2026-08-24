import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProfileManager } from '../../domain/ports/IProfileManager';
import { ProxyAgentTrackingCoordinator } from '../../services/proxyAgentTrackingCoordinator';
import type { AgentTrackingService } from '../../services/agentTrackingService';

function fakeService(): AgentTrackingService {
  return {} as AgentTrackingService;
}

describe('ProxyAgentTrackingCoordinator', () => {
  it('creates a service once and returns the cached instance', async () => {
    const service = fakeService();
    let createCount = 0;
    const initialized: string[] = [];
    const coordinator = new ProxyAgentTrackingCoordinator(
      '/extension',
      () => 4,
      {
        createService: async () => {
          createCount += 1;
          return service;
        },
        onInitialized: (profileId) => initialized.push(profileId),
      }
    );

    await coordinator.ensure('profile-1', '/profile-1');
    await coordinator.ensure('profile-1', '/profile-1');

    assert.equal(createCount, 1);
    assert.equal(coordinator.get('profile-1'), service);
    assert.deepEqual(initialized, ['profile-1']);
  });

  it('resolves a profile before creating its tracking service', async () => {
    const service = fakeService();
    const requested: string[] = [];
    const profileManager = {
      getProfile: async (profileId: string) => {
        requested.push(profileId);
        return profileId === 'known'
          ? ({ id: profileId, userDataDir: '/known' } as never)
          : null;
      },
    } as unknown as IProfileManager;
    const coordinator = new ProxyAgentTrackingCoordinator(
      '/extension',
      () => 4,
      { createService: async () => service }
    );

    await coordinator.ensureForProfile('missing', profileManager);
    await coordinator.ensureForProfile('known', profileManager);

    assert.deepEqual(requested, ['missing', 'known']);
    assert.equal(coordinator.get('missing'), undefined);
    assert.equal(coordinator.get('known'), service);
  });

  it('removes a cached service without affecting other profiles', async () => {
    const first = fakeService();
    const second = fakeService();
    const services = new Map([
      ['first', first],
      ['second', second],
    ]);
    const coordinator = new ProxyAgentTrackingCoordinator(
      '/extension',
      () => 4,
      {
        createService: async (profileId) => services.get(profileId)!,
      }
    );

    await coordinator.ensure('first', '/first');
    await coordinator.ensure('second', '/second');
    coordinator.delete('first');

    assert.equal(coordinator.get('first'), undefined);
    assert.equal(coordinator.get('second'), second);
  });
});
