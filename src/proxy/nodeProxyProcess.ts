import { fork, type ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import type { ProxyServerConfig } from '../application/types/proxyConfig';
import type {
  ProxyChildMessage,
  ProxyParentMessage,
} from '../application/types/proxyTraffic';
import type {
  IProxyProcess,
  ProxyProcessRuntime,
} from '../domain/ports/IProxyProcess';
import { isProcessAlive } from './portUtils';

export class NodeProxyProcess implements IProxyProcess {
  private child: ChildProcess | null = null;
  private readonly messageHandlers: Array<(msg: ProxyChildMessage) => void> = [];
  private readonly exitHandlers: Array<(code: number | null) => void> = [];
  private readonly stderrHandlers: Array<(chunk: string) => void> = [];

  constructor(
    private readonly scriptPath: string,
    private readonly extensionPath: string
  ) {}

  async start(config: ProxyServerConfig): Promise<ProxyProcessRuntime> {
    try {
      await fs.access(this.scriptPath);
    } catch {
      throw new Error(
        `Proxy server script not found at ${this.scriptPath}. Rebuild the extension.`
      );
    }

    const child = fork(this.scriptPath, [], {
      cwd: this.extensionPath,
      env: {
        ...process.env,
        CURSOR_ACCOUNTS_PROXY_CONFIG: JSON.stringify(config),
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      detached: false,
    });

    this.child = child;
    this.attachHandlers(child);

    return {
      port: config.port,
      pid: child.pid,
      startedAt: new Date(),
    };
  }

  private attachHandlers(child: ChildProcess): void {
    for (const handler of this.messageHandlers) {
      child.on('message', handler);
    }
    for (const handler of this.exitHandlers) {
      child.on('exit', handler);
    }
    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString().trim();
      for (const handler of this.stderrHandlers) {
        handler(chunk);
      }
    });
  }

  async stop(pid: number | undefined, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    if (this.child && !this.child.killed && this.child.pid != null) {
      try {
        this.child.kill(signal);
      } catch {
        // already dead
      }
      return;
    }

    if (pid != null && isProcessAlive(pid)) {
      try {
        process.kill(pid, signal);
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch {
        // process may already be gone
      }
    }
  }

  isAlive(pid: number): boolean {
    return isProcessAlive(pid);
  }

  isConnected(): boolean {
    return this.child?.connected === true;
  }

  onMessage(handler: (msg: ProxyChildMessage) => void): void {
    this.messageHandlers.push(handler);
    this.child?.on('message', handler);
  }

  onExit(handler: (code: number | null) => void): void {
    this.exitHandlers.push(handler);
    this.child?.on('exit', handler);
  }

  onStderr(handler: (chunk: string) => void): void {
    this.stderrHandlers.push(handler);
  }

  send(message: ProxyParentMessage): void {
    this.child?.send(message);
  }

  async sendShutdown(timeoutMs: number): Promise<void> {
    if (!this.child?.connected) {
      return;
    }
    this.child.send({ type: 'shutdown' } satisfies ProxyParentMessage);
    await this.waitForExit(timeoutMs);
  }

  waitForReady(
    port: number,
    timeoutMs: number
  ): Promise<{ success: boolean; port?: number; error?: string }> {
    const child = this.child;
    if (!child) {
      return Promise.resolve({ success: false, error: 'Proxy child not started' });
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          success: false,
          error: `Proxy did not become ready within ${timeoutMs}ms`,
        });
      }, timeoutMs);

      const onMessage = (msg: ProxyChildMessage) => {
        if (msg.type === 'ready') {
          clearTimeout(timeout);
          child.off('message', onMessage);
          resolve({ success: true, port: msg.port ?? port });
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          child.off('message', onMessage);
          resolve({ success: false, error: msg.message });
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

  /** Clear reference after force stop. */
  detach(): void {
    this.child = null;
  }

  getChild(): ChildProcess | null {
    return this.child;
  }
}
