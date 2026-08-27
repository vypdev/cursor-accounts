import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SharedProxyRuntimeStopUseCaseDependencies } from '../../application/services/sharedProxyRuntimeStopUseCase';
import {
  SHARED_PROXY_STOP_GRACE_MS,
  SharedProxyRuntimeStopUseCase,
} from '../../application/services/sharedProxyRuntimeStopUseCase';

function runtime() {
  return {
    process: {} as never,
    port: 8080,
    apiPort: 18_080,
    userDataDir: '/tmp/shared',
    apiToken: 'runtime-token',
  };
}

function setup() {
  let activeRuntime: ReturnType<typeof runtime> | undefined = runtime();
  const events: string[] = [];
  let shutdownError: Error | undefined;
  const dependencies: SharedProxyRuntimeStopUseCaseDependencies = {
    stateStore: {
      clear: async () => {
        events.push('clear-state');
      },
    },
    getRuntime: () => activeRuntime,
    createApiClient: () => ({
      shutdown: async () => {
        if (shutdownError) {
          throw shutdownError;
        }
        events.push('shutdown-api');
      },
    }),
    wait: async (milliseconds) => {
      assert.equal(milliseconds, SHARED_PROXY_STOP_GRACE_MS);
      events.push('wait');
    },
    stopRuntime: async () => {
      events.push('stop-runtime');
      activeRuntime = undefined;
    },
    stopTrafficIngress: () => {
      events.push('stop-ingress');
    },
    notifyStatusChange: () => {
      events.push('notify');
    },
    logDebug: (message) => {
      events.push(`debug:${message}`);
    },
  };

  return {
    dependencies,
    setRuntime: (value: typeof activeRuntime) => {
      activeRuntime = value;
    },
    setShutdownError: (error: Error | undefined) => {
      shutdownError = error;
    },
    events,
  };
}

describe('SharedProxyRuntimeStopUseCase', () => {
  it('does nothing when there is no active runtime', async () => {
    const setupState = setup();
    setupState.setRuntime(undefined);
    const useCase = new SharedProxyRuntimeStopUseCase(setupState.dependencies);

    await useCase.execute();

    assert.deepEqual(setupState.events, []);
  });

  it('shuts down the API before stopping and clearing the runtime', async () => {
    const setupState = setup();
    const useCase = new SharedProxyRuntimeStopUseCase(setupState.dependencies);

    await useCase.execute();

    assert.deepEqual(setupState.events, [
      'shutdown-api',
      'wait',
      'stop-runtime',
      'stop-ingress',
      'clear-state',
      'notify',
    ]);
  });

  it('continues cleanup when API shutdown fails', async () => {
    const setupState = setup();
    setupState.setShutdownError(new Error('API unavailable'));
    const useCase = new SharedProxyRuntimeStopUseCase(setupState.dependencies);

    await useCase.execute();

    assert.equal(setupState.events[0], 'debug:[Proxy:shared] API shutdown failed: API unavailable');
    assert.deepEqual(setupState.events.slice(1), [
      'stop-runtime',
      'stop-ingress',
      'clear-state',
      'notify',
    ]);
  });
});
