import { fork, type ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ProxyStartResult, IProxyManager } from '../domain/ports/IProxyManager';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import type { ProxyStateFile, ProxyStatus } from '@cursor-accounts/types';
import * as extensionLog from '../logging/extensionLog';
import { CertificateManager } from '../proxy/certificateManager';
import { isPortAvailable, isProcessAlive, resolveAvailablePort } from '../proxy/portUtils';
import {
  DEFAULT_PROXY_PORT,
  PROXY_STATE_SCHEMA_VERSION,
  PROXY_STATE_STALE_MS,
  type ProxyChildMessage,
  type ProxyParentMessage,
  type ProxyServerConfig,
} from '../proxy/types';

const PROXY_START_TIMEOUT_MS = 15_000;
const PROXY_STOP_TIMEOUT_MS = 5_000;

/**
 * Orchestrates the MITM proxy child process and shared state file.
 */
export class ProxyManager implements IProxyManager {
  private childProcess: ChildProcess | null = null;
  private activePort: number | null = null;
  private statusCallbacks: Array<() => void> = [];
  private readonly storageDir: string;
  private readonly logDir: string;
  private readonly certManager: CertificateManager;

  constructor(
    private readonly stateStore: IProxyStateStore,
    private readonly context: vscode.ExtensionContext
  ) {
    const base = context.globalStorageUri.fsPath;
    this.storageDir = path.join(base, 'proxy');
    this.logDir = path.join(this.storageDir, 'logs');
    this.certManager = new CertificateManager(path.join(this.storageDir, 'certs'));
  }

  onStatusChange(callback: () => void): void {
    this.statusCallbacks.push(callback);
  }

  async start(): Promise<ProxyStartResult> {
    try {
      const existing = await this.getStatus();
      if (existing?.running && existing.port != null) {
        return { success: true, port: existing.port };
      }

      const config = vscode.workspace.getConfiguration('cursorAccounts.proxy');
      const preferredPort = config.get<number>('port', DEFAULT_PROXY_PORT);
      const maxLogSizeMb = config.get<number>('maxLogSizeMB', 100);

      const port = await resolveAvailablePort(preferredPort);
      if (port == null) {
        return {
          success: false,
          error: 'No available port for proxy (tried 8080, 8081, 8082, 8888)',
        };
      }

      await fs.mkdir(this.storageDir, { recursive: true });
      await fs.mkdir(this.logDir, { recursive: true });

      const caPath = await this.certManager.ensureCaCertificate();

      const serverConfig: ProxyServerConfig = {
        port,
        storageDir: this.storageDir,
        logDir: this.logDir,
        maxLogSizeMb,
      };

      const scriptPath = path.join(
        this.context.extensionPath,
        'out',
        'proxy',
        'proxyServer.js'
      );

      try {
        await fs.access(scriptPath);
      } catch {
        return {
          success: false,
          error: `Proxy server script not found at ${scriptPath}. Rebuild the extension.`,
        };
      }

      const child = fork(scriptPath, [], {
        cwd: this.context.extensionPath,
        env: {
          ...process.env,
          CURSOR_ACCOUNTS_PROXY_CONFIG: JSON.stringify(serverConfig),
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        detached: false,
      });

      this.childProcess = child;
      this.activePort = port;

      child.stderr?.on('data', (chunk: Buffer) => {
        extensionLog.debug(`[Proxy] ${chunk.toString().trim()}`);
      });

      child.on('exit', (code) => {
        extensionLog.warn(`[Proxy] Child process exited with code ${code ?? 'unknown'}`);
        this.childProcess = null;
        this.activePort = null;
        void this.stateStore.clear();
        this.notifyStatusChange();
      });

      const ready = await this.waitForReady(child, port);
      if (!ready.success) {
        await this.forceStopChild();
        return ready;
      }

      const state: ProxyStateFile = {
        version: PROXY_STATE_SCHEMA_VERSION,
        running: true,
        port,
        pid: child.pid,
        startedAt: new Date().toISOString(),
        caCertificatePath: caPath,
        lastUpdatedAt: new Date().toISOString(),
      };
      await this.stateStore.write(state);

      extensionLog.info(`[Proxy] Started on 127.0.0.1:${port} (pid ${child.pid})`);
      this.notifyStatusChange();

      return { success: true, port };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      extensionLog.error(`[Proxy] start failed: ${message}`);
      return { success: false, error: message };
    }
  }

  async stop(): Promise<void> {
    try {
      if (this.childProcess?.connected) {
        this.childProcess.send({ type: 'shutdown' } satisfies ProxyParentMessage);
        await this.waitForExit(this.childProcess, PROXY_STOP_TIMEOUT_MS);
      }
      await this.forceStopChild();
      await this.stateStore.clear();
      extensionLog.info('[Proxy] Stopped');
      this.notifyStatusChange();
    } catch (error) {
      extensionLog.error(
        `[Proxy] stop failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getStatus(): Promise<ProxyStatus | null> {
    const state = await this.stateStore.read();
    if (!state) {
      if (this.childProcess && this.activePort != null) {
        return this.buildStatusFromChild(this.activePort);
      }
      return { running: false, logDirectory: this.logDir };
    }

    const stale = this.isStateStale(state);
    const alive =
      state.pid != null && isProcessAlive(state.pid) && !stale;

    if (!alive) {
      if (state.running) {
        await this.stateStore.clear();
      }
      return {
        running: false,
        logDirectory: this.logDir,
        caCertificatePath: state.caCertificatePath,
      };
    }

    const port = state.port;
    const portListening =
      port != null ? !(await isPortAvailable(port)) : false;

    if (!portListening && state.running) {
      await this.stateStore.clear();
      return {
        running: false,
        logDirectory: this.logDir,
        caCertificatePath: state.caCertificatePath,
      };
    }

    return {
      running: true,
      port: state.port,
      pid: state.pid,
      startedAt: state.startedAt
        ? new Date(state.startedAt).getTime()
        : undefined,
      caCertificatePath: state.caCertificatePath,
      logDirectory: this.logDir,
    };
  }

  async isRunning(): Promise<boolean> {
    const status = await this.getStatus();
    return status?.running === true;
  }

  async isCurrentWindowUsingProxy(): Promise<boolean> {
    const hasProxyArg = process.argv.some((arg) =>
      arg.includes('--proxy-server')
    );
    const hasCaCert =
      process.env.NODE_EXTRA_CA_CERTS != null &&
      process.env.NODE_EXTRA_CA_CERTS.length > 0;
    return hasProxyArg || hasCaCert;
  }

  async getCertificatePath(): Promise<string | null> {
    const state = await this.stateStore.read();
    if (state?.caCertificatePath) {
      try {
        await fs.access(state.caCertificatePath);
        return state.caCertificatePath;
      } catch {
        // fall through
      }
    }

    try {
      return await this.certManager.ensureCaCertificate();
    } catch {
      return null;
    }
  }

  getLogDirectory(): string {
    return this.logDir;
  }

  async getCertificateInstallationInstructions(): Promise<string> {
    const certPath =
      (await this.getCertificatePath()) ??
      path.join(this.storageDir, 'certs', 'ca-cert.pem');
    return this.certManager.getInstallationInstructions(certPath);
  }

  /**
   * Build proxy URL for ProfileLauncher when proxy is running.
   */
  async getProxyServerUrl(): Promise<string | null> {
    const running = await this.isRunning();
    if (!running) {
      return null;
    }
    const status = await this.getStatus();
    if (!status?.port) {
      return null;
    }
    return `http://127.0.0.1:${status.port}`;
  }

  private buildStatusFromChild(port: number): ProxyStatus {
    return {
      running: true,
      port,
      pid: this.childProcess?.pid,
      logDirectory: this.logDir,
    };
  }

  private isStateStale(state: ProxyStateFile): boolean {
    const updated = new Date(state.lastUpdatedAt).getTime();
    if (Number.isNaN(updated)) {
      return true;
    }
    return Date.now() - updated > PROXY_STATE_STALE_MS;
  }

  private notifyStatusChange(): void {
    for (const cb of this.statusCallbacks) {
      try {
        cb();
      } catch (error) {
        extensionLog.debug(
          `[Proxy] status callback error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  private waitForReady(
    child: ChildProcess,
    port: number
  ): Promise<ProxyStartResult> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          success: false,
          error: `Proxy did not become ready within ${PROXY_START_TIMEOUT_MS}ms`,
        });
      }, PROXY_START_TIMEOUT_MS);

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

  private waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      if (child.exitCode != null || child.killed) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        resolve();
      }, timeoutMs);

      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async forceStopChild(): Promise<void> {
    const child = this.childProcess;
    this.childProcess = null;
    this.activePort = null;

    if (!child) {
      return;
    }

    if (!child.killed && child.pid != null) {
      try {
        child.kill('SIGTERM');
      } catch {
        // already dead
      }
    }
  }
}
