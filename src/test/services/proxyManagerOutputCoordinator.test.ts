import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type {
  IProxyOutputPresenter,
  ITokenDetectorOutputPresenter,
} from '../../domain/ports/IProxyOutputPresenter';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';
import { ProxyManagerOutputCoordinator } from '../../services/proxyManagerOutputCoordinator';

const summary: ProxyTrafficSummary = {
  timestamp: new Date(1_000).toISOString(),
  kind: 'response',
  url: 'https://api.cursor.com/agent',
  host: 'api.cursor.com',
  endpoint: '/agent',
};

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

function createPresenters() {
  const output: IProxyOutputPresenter & {
    shown: number;
    disabled: number;
    traffic: ProxyTrafficSummary[];
  } = {
    appendStarted: () => undefined,
    appendAttached: () => undefined,
    appendTailing: () => undefined,
    appendLogDisabled: () => {
      output.disabled += 1;
    },
    appendStopped: () => undefined,
    appendDiagnostics: () => undefined,
    appendTraffic: (event) => output.traffic.push(event),
    appendError: () => undefined,
    show: () => {
      output.shown += 1;
    },
    shown: 0,
    disabled: 0,
    traffic: [],
  };
  const token: ITokenDetectorOutputPresenter & {
    shown: number;
    traffic: Array<{ event: ProxyTrafficSummary; profileId?: string }>;
  } = {
    appendInitialized: () => undefined,
    appendTraffic: (event, profileId) => token.traffic.push({ event, profileId }),
    show: () => {
      token.shown += 1;
    },
    shown: 0,
    traffic: [],
  };
  return { output, token };
}

describe('ProxyManagerOutputCoordinator', () => {
  it('forwards output channel and tailer operations', async () => {
    const presenters = createPresenters();
    const tailerCalls: string[] = [];
    const coordinator = new ProxyManagerOutputCoordinator({
      logDir: '/tmp/proxy-logs',
      getOutputConfig: () => ({
        logTrafficToOutput: false,
        autoShowOutputChannel: false,
        outputCursorHostsOnly: false,
      }),
      getRuntimeCount: () => 0,
      outputPresenter: presenters.output,
      tokenDetectorPresenter: presenters.token,
      ensureOutputTailer: async (profileId) => {
        tailerCalls.push(`profile:${profileId}`);
      },
      ensureTrafficTailer: async () => {
        tailerCalls.push('shared');
      },
    });

    assert.equal(coordinator.getLogDirectory(), '/tmp/proxy-logs');
    coordinator.showOutputChannel();
    coordinator.showTokenDetectorChannel();
    await coordinator.ensureOutputTailer('profile-1');
    await coordinator.ensureTrafficTailer();

    assert.equal(presenters.output.shown, 1);
    assert.equal(presenters.output.disabled, 1);
    assert.equal(presenters.token.shown, 1);
    assert.deepEqual(tailerCalls, ['profile:profile-1', 'shared']);
  });

  it('publishes traffic to the token presenter and optional output presenter', () => {
    const presenters = createPresenters();
    const coordinator = new ProxyManagerOutputCoordinator({
      logDir: '/tmp/proxy-logs',
      getOutputConfig: () => ({
        logTrafficToOutput: true,
        autoShowOutputChannel: false,
        outputCursorHostsOnly: false,
      }),
      getRuntimeCount: () => 0,
      outputPresenter: presenters.output,
      tokenDetectorPresenter: presenters.token,
      ensureOutputTailer: async () => undefined,
      ensureTrafficTailer: async () => undefined,
    });

    coordinator.presentTraffic(summary, 'profile-1');

    assert.deepEqual(presenters.output.traffic, [summary]);
    assert.deepEqual(presenters.token.traffic, [
      { event: summary, profileId: 'profile-1' },
    ]);
  });

  it('rejects log cleanup while a runtime is active', async () => {
    const coordinator = new ProxyManagerOutputCoordinator({
      logDir: '/tmp/proxy-logs',
      getOutputConfig: () => ({
        logTrafficToOutput: true,
        autoShowOutputChannel: false,
        outputCursorHostsOnly: false,
      }),
      getRuntimeCount: () => 1,
      ensureOutputTailer: async () => undefined,
      ensureTrafficTailer: async () => undefined,
    });

    await assert.rejects(
      coordinator.clearLogFiles(),
      /Stop the proxy before deleting its logs/
    );
  });

  it('clears logs when no runtime is active', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'proxy-output-coordinator-'));
    tempDirectories.push(directory);
    const coordinator = new ProxyManagerOutputCoordinator({
      logDir: directory,
      getOutputConfig: () => ({
        logTrafficToOutput: true,
        autoShowOutputChannel: false,
        outputCursorHostsOnly: false,
      }),
      getRuntimeCount: () => 0,
      ensureOutputTailer: async () => undefined,
      ensureTrafficTailer: async () => undefined,
    });

    assert.deepEqual(await coordinator.clearLogFiles(), {
      deletedFiles: 0,
      deletedBytes: 0,
    });
  });
});
