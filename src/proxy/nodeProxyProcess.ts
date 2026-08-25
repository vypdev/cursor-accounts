import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import type { ProxyServerConfig } from '../application/types/proxyConfig';
import type {
  IProxyProcess,
  ProxyProcessRuntime,
} from '../domain/ports/IProxyProcess';
import { isProcessAlive } from './portUtils';

export class NodeProxyProcess implements IProxyProcess {
  private child: ChildProcess | null = null;
  private readonly exitHandlers: Array<(code: number | null) => void> = [];
  private readonly stderrHandlers: Array<(chunk: string) => void> = [];

  constructor(
    private readonly scriptPath: string,
    private readonly extensionPath: string
  ) {}

  async start(config: ProxyServerConfig): Promise<ProxyProcessRuntime> {
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      throw new Error('Proxy process is already running');
    }

    try {
      await fs.access(this.scriptPath);
    } catch {
      throw new Error(
        `Proxy server script not found at ${this.scriptPath}. Rebuild the extension.`
      );
    }

    const child = spawn(process.execPath, [this.scriptPath], {
      cwd: this.extensionPath,
      env: {
        ...process.env,
        CURSOR_ACCOUNTS_PROXY_CONFIG: JSON.stringify(config),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    this.child = child;
    this.attachHandlers(child);

    return {
      port: config.port,
      apiPort: config.apiPort,
      pid: child.pid,
      startedAt: new Date(),
    };
  }

  private attachHandlers(child: ChildProcess): void {
    child.once('exit', () => {
      if (this.child === child) {
        this.child = null;
      }
    });

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

  onExit(handler: (code: number | null) => void): void {
    this.exitHandlers.push(handler);
    this.child?.on('exit', handler);
  }

  onStderr(handler: (chunk: string) => void): void {
    this.stderrHandlers.push(handler);
  }

  /** Clear reference after force stop. */
  detach(): void {
    this.child = null;
  }

  getChild(): ChildProcess | null {
    return this.child;
  }
}
