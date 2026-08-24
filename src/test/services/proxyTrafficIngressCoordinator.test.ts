import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProfileManager } from '../../domain/ports/IProfileManager';
import type { IProxyTrafficIngress } from '../../domain/ports/IProxyTrafficIngress';
import { ProxyTrafficIngressCoordinator } from '../../services/proxyTrafficIngressCoordinator';

function createCoordinator(options: {
  profiles?: unknown[];
  profile?: unknown;
  hasRuntime?: boolean;
  logTrafficToOutput?: boolean;
  start?: IProxyTrafficIngress['start'];
}) {
  const starts: Array<Parameters<IProxyTrafficIngress['start']>> = [];
  const attachedPorts: number[] = [];
  const profileManager = {
    getProfiles: async () => options.profiles ?? [],
    getProfile: async () => options.profile ?? null,
  } as unknown as IProfileManager;
  const trafficIngress = {
    start: async (...args: Parameters<IProxyTrafficIngress['start']>) => {
      starts.push(args);
      await options.start?.(...args);
    },
  } as unknown as IProxyTrafficIngress;

  return {
    starts,
    attachedPorts,
    coordinator: new ProxyTrafficIngressCoordinator({
      profileManager,
      trafficIngress,
      outputPresenter: {
        appendAttached: (port: number) => attachedPorts.push(port),
      } as never,
      getOutputConfig: () => ({
        logTrafficToOutput: options.logTrafficToOutput ?? true,
        autoShowOutputChannel: false,
        outputCursorHostsOnly: false,
      }),
      hasRuntime: () => options.hasRuntime ?? false,
      sharedRuntimeKey: 'shared',
    }),
  };
}

describe('ProxyTrafficIngressCoordinator', () => {
  it('enables JSONL tailing for a shared proxy when any profile requests it', async () => {
    const { coordinator, starts } = createCoordinator({
      profiles: [
        { proxyJsonlLoggingEnabled: false },
        { proxyJsonlLoggingEnabled: true },
      ],
    });

    await coordinator.ensure('shared', 8080, 18080);

    assert.equal(starts[0]?.[2].jsonlTail, true);
    assert.equal(starts[0]?.[3]?.attached, true);
  });

  it('does not report an attachment for an existing runtime', async () => {
    const { coordinator, starts, attachedPorts } = createCoordinator({
      profile: { proxyJsonlLoggingEnabled: false },
      hasRuntime: true,
      logTrafficToOutput: true,
    });

    await coordinator.ensure('profile-1', 8081, 18081);

    assert.deepEqual(attachedPorts, []);
    assert.equal(starts[0]?.[2].jsonlTail, false);
    assert.equal(starts[0]?.[3]?.attached, false);
  });

  it('reports a forced restart as a fresh attachment and forwards options', async () => {
    const { coordinator, starts, attachedPorts } = createCoordinator({
      profile: { proxyJsonlLoggingEnabled: true },
      hasRuntime: true,
    });

    await coordinator.ensure('profile-1', 8082, 18082, {
      forceRestart: true,
      tailFromStart: true,
      apiToken: 'token',
    });

    assert.deepEqual(attachedPorts, [8082]);
    assert.deepEqual(starts[0]?.[3], {
      apiPort: 18082,
      apiToken: 'token',
      attached: true,
      tailFromStart: true,
      forceRestart: true,
    });
  });
});
