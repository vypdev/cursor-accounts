import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  ProxyServerProcessDependencies,
  ProxyServerProcessRuntime,
} from '../../proxy/proxyServerProcess';
import { runProxyServerProcess } from '../../proxy/proxyServerProcess';
import type { ProxyServerConfig } from '../../proxy/types';

function config(): ProxyServerConfig {
  return {
    port: 8080,
    apiPort: 18080,
    profileId: 'profile-a',
    storageDir: '/tmp/proxy',
    logDir: '/tmp/proxy/logs',
    maxLogSizeMb: 50,
    maxBodyLogBytes: 1024,
    spillLargeBodies: false,
    developmentMode: false,
    trafficDiagnostics: false,
    diagnosticsIntervalMs: 30_000,
  };
}

function dependencies(
  overrides: Partial<ProxyServerProcessDependencies> = {},
  runtime: ProxyServerProcessRuntime = {
    start: async () => undefined,
    shutdown: async () => undefined,
  }
): ProxyServerProcessDependencies {
  return {
    parseConfig: () => config(),
    createRuntime: () => runtime,
    pid: 1234,
    on: () => undefined,
    exit: () => undefined,
    writeStderr: () => undefined,
    ...overrides,
  };
}

describe('runProxyServerProcess', () => {
  it('starts the composed runtime and registers both termination signals', async () => {
    const signals: NodeJS.Signals[] = [];
    let startedPid: number | undefined;
    const runtime: ProxyServerProcessRuntime = {
      start: async (receivedConfig, pid) => {
        assert.equal(receivedConfig.profileId, 'profile-a');
        startedPid = pid;
      },
      shutdown: async () => undefined,
    };

    await runProxyServerProcess(
      dependencies({
        on: (signal) => signals.push(signal),
      }, runtime)
    );

    assert.equal(startedPid, 1234);
    assert.deepEqual(signals, ['SIGTERM', 'SIGINT']);
  });

  it('logs startup failures, shuts down the runtime, and exits with status 1', async () => {
    let shutdownCalls = 0;
    const exits: number[] = [];
    const messages: string[] = [];
    const runtime: ProxyServerProcessRuntime = {
      start: async () => {
        throw new Error('listen failed');
      },
      shutdown: async () => {
        shutdownCalls += 1;
      },
    };

    await runProxyServerProcess(
      dependencies(
        {
          exit: (code) => exits.push(code),
          writeStderr: (message) => messages.push(message),
        },
        runtime
      )
    );

    assert.equal(shutdownCalls, 1);
    assert.deepEqual(exits, [1]);
    assert.deepEqual(messages, ['[proxy] startup failed: listen failed\n']);
  });

  it('exits successfully when a registered termination signal completes shutdown', async () => {
    let signalHandler: (() => void) | undefined;
    const exits: number[] = [];
    let shutdownCalls = 0;
    const runtime: ProxyServerProcessRuntime = {
      start: async () => undefined,
      shutdown: async () => {
        shutdownCalls += 1;
      },
    };

    await runProxyServerProcess(
      dependencies(
        {
          on: (_signal, listener) => {
            signalHandler = listener;
          },
          exit: (code) => exits.push(code),
        },
        runtime
      )
    );

    signalHandler?.();
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(shutdownCalls, 1);
    assert.deepEqual(exits, [0]);
  });

  it('exits with status 1 when configuration parsing fails before runtime creation', async () => {
    const exits: number[] = [];
    const messages: string[] = [];

    await runProxyServerProcess(
      dependencies({
        parseConfig: () => {
          throw new Error('invalid configuration');
        },
        exit: (code) => exits.push(code),
        writeStderr: (message) => messages.push(message),
      })
    );

    assert.deepEqual(exits, [1]);
    assert.deepEqual(messages, [
      '[proxy] startup failed: invalid configuration\n',
    ]);
  });
});
