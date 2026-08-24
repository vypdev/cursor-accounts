import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProxyStateStore } from '../../domain/ports/IProxyStateStore';
import type { SharedProxyRuntime } from '../../services/sharedProxyLifecycleCoordinator';
import { ProxyChildProcessStopCoordinator } from '../../services/proxyChildProcessStopCoordinator';

function createProcess(aliveAfterTerm: boolean) {
  const stops: Array<{ pid: number | undefined; signal: NodeJS.Signals | undefined }> = [];
  const process = {
    stop: async (pid: number | undefined, signal?: NodeJS.Signals) => {
      stops.push({ pid, signal });
    },
    isAlive: () => aliveAfterTerm,
  };
  return { process, stops };
}

function createCoordinator(options: {
  hasRuntime?: boolean;
  runtime?: SharedProxyRuntime;
  state?: { pid?: number } | null;
  childPid?: number;
  aliveAfterTerm?: boolean;
}) {
  const { process, stops } = createProcess(options.aliveAfterTerm ?? true);
  const runtime = options.hasRuntime === false
    ? undefined
    : options.runtime ?? {
    process: process as never,
    port: 8080,
    apiPort: 18_080,
    userDataDir: '/tmp/proxy',
  };
  const events: string[] = [];
  const stateStore: IProxyStateStore = {
    read: async () => options.state as never,
    write: async () => undefined,
    clear: async () => undefined,
  };
  const coordinator = new ProxyChildProcessStopCoordinator({
    getRuntime: () => runtime,
    deleteRuntime: () => events.push('delete-runtime'),
    deleteAgentTracking: () => events.push('delete-tracking'),
    stateStore,
    getChildPid: () => options.childPid,
    detach: () => events.push('detach'),
    gracePeriodMs: 0,
    wait: async () => {
      events.push('wait');
    },
  });
  return { coordinator, stops, events };
}

describe('ProxyChildProcessStopCoordinator', () => {
  it('clears ownership even when no child runtime exists', async () => {
    const { coordinator, events } = createCoordinator({ hasRuntime: false });

    await coordinator.stop('profile-1');

    assert.deepEqual(events, ['delete-runtime', 'delete-tracking']);
  });

  it('uses the child PID and escalates when SIGTERM does not stop it', async () => {
    const { coordinator, stops, events } = createCoordinator({ childPid: 456 });

    await coordinator.stop('profile-1');

    assert.deepEqual(stops, [
      { pid: 456, signal: 'SIGTERM' },
      { pid: 456, signal: 'SIGKILL' },
    ]);
    assert.deepEqual(events, [
      'delete-runtime',
      'delete-tracking',
      'wait',
      'detach',
    ]);
  });

  it('falls back to the persisted PID and avoids SIGKILL after a clean stop', async () => {
    const { coordinator, stops, events } = createCoordinator({
      childPid: undefined,
      state: { pid: 789 },
      aliveAfterTerm: false,
    });

    await coordinator.stop('profile-1');

    assert.deepEqual(stops, [{ pid: 789, signal: 'SIGTERM' }]);
    assert.deepEqual(events, [
      'delete-runtime',
      'delete-tracking',
      'wait',
      'detach',
    ]);
  });
});
