import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  ProfileLauncherError,
  ProfileProcessLauncher,
  type ProfileSpawnProcess,
} from '../profiles/profileProcessLauncher';

class FakeChildProcess extends EventEmitter {
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  unrefCalls = 0;

  unref(): this {
    this.unrefCalls += 1;
    return this;
  }
}

function asChildProcess(child: FakeChildProcess): ChildProcess {
  return child as unknown as ChildProcess;
}

describe('ProfileProcessLauncher', () => {
  it('launches a background process with a clean environment', async () => {
    const child = new FakeChildProcess();
    let command = '';
    let args: string[] = [];
    let environment: NodeJS.ProcessEnv | undefined;

    const launcher = new ProfileProcessLauncher({
      platform: 'linux',
      verifyDelayMs: 0,
      spawnProcess: ((spawnCommand, spawnArgs = [], options = {}) => {
        command = spawnCommand;
        args = [...spawnArgs];
        environment = options.env;
        return asChildProcess(child);
      }) as ProfileSpawnProcess,
    });

    await launcher.launch({
      executablePath: '/usr/bin/cursor',
      args: ['--user-data-dir', '/tmp/profile'],
      caCertPath: '/tmp/ca-cert.pem',
    });

    assert.equal(command, '/usr/bin/cursor');
    assert.deepEqual(args, ['--user-data-dir', '/tmp/profile']);
    assert.equal(environment?.NODE_EXTRA_CA_CERTS, '/tmp/ca-cert.pem');
    assert.equal(child.unrefCalls, 1);
  });

  it('rejects when a background process exits before verification', async () => {
    const child = new FakeChildProcess();
    child.exitCode = 1;
    const launcher = new ProfileProcessLauncher({
      platform: 'linux',
      verifyDelayMs: 0,
      spawnProcess: (() => asChildProcess(child)) as ProfileSpawnProcess,
    });

    await assert.rejects(
      launcher.launch({ executablePath: '/usr/bin/cursor', args: [] }),
      (error: unknown) =>
        error instanceof ProfileLauncherError &&
        error.message === 'Process failed to start'
    );
  });

  it('uses LaunchServices semantics on macOS', async () => {
    const child = new FakeChildProcess();
    let command = '';
    let args: string[] = [];
    const launcher = new ProfileProcessLauncher({
      platform: 'darwin',
      spawnProcess: ((spawnCommand, spawnArgs = []) => {
        command = spawnCommand;
        args = [...spawnArgs];
        queueMicrotask(() => child.emit('exit', 0));
        return asChildProcess(child);
      }) as ProfileSpawnProcess,
    });

    await launcher.launch({
      executablePath: '/Applications/Cursor.app/Contents/MacOS/Cursor',
      appBundlePath: '/Applications/Cursor.app',
      args: ['--user-data-dir', '/tmp/profile'],
    });

    assert.equal(command, 'open');
    assert.deepEqual(args, [
      '-na',
      '/Applications/Cursor.app',
      '--args',
      '--user-data-dir',
      '/tmp/profile',
    ]);
  });

  it('wraps synchronous spawn failures', async () => {
    const launcher = new ProfileProcessLauncher({
      platform: 'linux',
      spawnProcess: (() => {
        throw new Error('spawn unavailable');
      }) as ProfileSpawnProcess,
    });

    await assert.rejects(
      launcher.launch({ executablePath: '/usr/bin/cursor', args: [] }),
      (error: unknown) =>
        error instanceof ProfileLauncherError &&
        error.message === 'Failed to spawn process' &&
        error.cause?.message === 'spawn unavailable'
    );
  });
});
