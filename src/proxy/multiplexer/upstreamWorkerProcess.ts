import { fork, type ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ProxyTrafficSummary } from '../../application/types/proxyTraffic';
import type {
  UpstreamWorkerChildMessage,
  UpstreamWorkerConfig,
  UpstreamWorkerParentMessage,
} from './upstreamWorkerTypes';

const WORKER_READY_TIMEOUT_MS = 15_000;

/** Manages a forked upstream analysis worker child process. */
export class UpstreamWorkerProcess {
  private child: ChildProcess | null = null;
  private readonly messageHandlers: Array<(msg: UpstreamWorkerChildMessage) => void> =
    [];
  private readonly exitHandlers: Array<(code: number | null) => void> = [];

  constructor(
    private readonly scriptPath: string,
    private readonly extensionPath: string
  ) {}

  async start(config: UpstreamWorkerConfig): Promise<void> {
    try {
      await fs.access(this.scriptPath);
    } catch {
      throw new Error(
        `Upstream worker script not found at ${this.scriptPath}. Rebuild the extension.`
      );
    }

    const child = fork(this.scriptPath, [], {
      cwd: this.extensionPath,
      env: {
        ...process.env,
        CURSOR_ACCOUNTS_UPSTREAM_WORKER_CONFIG: JSON.stringify(config),
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      detached: false,
    });

    this.child = child;
    for (const handler of this.messageHandlers) {
      child.on('message', handler);
    }
    for (const handler of this.exitHandlers) {
      child.on('exit', handler);
    }

    await this.waitForReady(config.upstreamId);
  }

  sendTraffic(summary: ProxyTrafficSummary): void {
    const message: UpstreamWorkerParentMessage = { type: 'traffic', summary };
    this.child?.send(message);
  }

  async stop(): Promise<void> {
    if (!this.child?.connected) {
      this.child = null;
      return;
    }

    this.child.send({ type: 'shutdown' } satisfies UpstreamWorkerParentMessage);
    await this.waitForExit(5_000);
    this.child = null;
  }

  isAlive(): boolean {
    return this.child?.connected === true && this.child.exitCode == null;
  }

  onMessage(handler: (msg: UpstreamWorkerChildMessage) => void): void {
    this.messageHandlers.push(handler);
    this.child?.on('message', handler);
  }

  onExit(handler: (code: number | null) => void): void {
    this.exitHandlers.push(handler);
    this.child?.on('exit', handler);
  }

  private waitForReady(upstreamId: string): Promise<void> {
    const child = this.child;
    if (!child) {
      return Promise.reject(new Error('Worker child not started'));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `Upstream worker ${upstreamId} did not become ready within ${WORKER_READY_TIMEOUT_MS}ms`
          )
        );
      }, WORKER_READY_TIMEOUT_MS);

      const onMessage = (msg: UpstreamWorkerChildMessage) => {
        if (msg.type === 'ready' && msg.upstreamId === upstreamId) {
          clearTimeout(timeout);
          child.off('message', onMessage);
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          child.off('message', onMessage);
          reject(new Error(msg.message));
        }
      };

      child.on('message', onMessage);
    });
  }

  private waitForExit(timeoutMs: number): Promise<void> {
    const child = this.child;
    if (!child) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      if (child.exitCode != null || child.killed) {
        resolve();
        return;
      }

      const timer = setTimeout(() => resolve(), timeoutMs);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  static resolveScriptPath(extensionPath: string): string {
    return path.join(extensionPath, 'out', 'proxy', 'multiplexer', 'upstreamWorker.js');
  }
}
