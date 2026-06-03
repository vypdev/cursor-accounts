import { fork, type ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
  ProxyStartResult,
  IProxyManager,
  RestoreAllProfilesResult,
} from '../domain/ports/IProxyManager';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import type { ProxySettingsService } from './proxySettingsService';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import type {
  ProxyInstallGuide,
  ProxyStateFile,
  ProxyStatus,
} from '@cursor-accounts/types';
import { buildProxyInstallGuide } from '../proxy/buildProxyInstallGuide';
import { verifyCaCertificateInstalled } from '../proxy/installCaCertificate';
import * as extensionLog from '../logging/extensionLog';
import { CertificateManager } from '../proxy/certificateManager';
import { getSharedProxyStorageDir } from '../proxy/sharedProxyPaths';
import { ProxyOutputPresenter, getProxyOutputConfig } from '../proxy/proxyOutputPresenter';
import { ProxyLogTailer } from '../proxy/proxyLogTailer';
import { isPortAvailable, isProcessAlive } from '../proxy/portUtils';
import {
  getAllUsedProxyPorts,
  resolvePortForProfile,
} from '../proxy/resolvePortForProfile';
import {
  PROXY_STATE_SCHEMA_VERSION,
  PROXY_STATE_FILE_NAME,
  type ProxyChildMessage,
  type ProxyParentMessage,
  type ProxyServerConfig,
} from '../proxy/types';

const PROXY_START_TIMEOUT_MS = 15_000;
const PROXY_STOP_TIMEOUT_MS = 5_000;

interface ProfileProxyRuntime {
  childProcess: ChildProcess;
  port: number;
  userDataDir: string;
}

/**
 * Orchestrates per-profile MITM proxy child processes and profile-local state files.
 */
export class ProxyManager implements IProxyManager {
  private readonly childProcesses = new Map<string, ProfileProxyRuntime>();
  private readonly statusCallbacks: Array<() => void> = [];
  private cachedCertificateInstalled: boolean | undefined;
  private logTailer: ProxyLogTailer | null = null;
  private logTailerStartedForPort: number | null = null;
  private readonly storageDir: string;
  private readonly logDir: string;
  private readonly certManager: CertificateManager;

  constructor(
    private readonly stateStore: IProxyStateStore,
    private readonly profileManager: IProfileManager,
    private readonly context: vscode.ExtensionContext,
    storageDir: string = getSharedProxyStorageDir(),
    private readonly proxySettingsService?: ProxySettingsService,
    private readonly profileSettingsManager?: IProfileSettingsManager,
    private readonly outputPresenter?: ProxyOutputPresenter
  ) {
    this.storageDir = storageDir;
    this.logDir = path.join(this.storageDir, 'logs');
    this.certManager = new CertificateManager(path.join(this.storageDir, 'certs'));
  }

  onStatusChange(callback: () => void): void {
    this.statusCallbacks.push(callback);
  }

  async start(profileId: string): Promise<ProxyStartResult> {
    try {
      const profile = await this.profileManager.getProfile(profileId);
      if (!profile) {
        return { success: false, error: `Profile ${profileId} not found` };
      }

      const existing = await this.getStatus(profileId);
      if (existing?.running && existing.port != null) {
        await this.ensureLogTailer(profileId, existing.port, { attached: true });
        await this.applyProxySettingsForProfile(profile.userDataDir, existing.port);
        return { success: true, port: existing.port };
      }

      const port = await resolvePortForProfile(
        profileId,
        this.profileManager,
        this.stateStore
      );
      if (port == null) {
        return {
          success: false,
          error: 'No available port for proxy (tried 8080, 8081, 8082, 8888)',
        };
      }

      await fs.mkdir(this.storageDir, { recursive: true });
      await fs.mkdir(this.logDir, { recursive: true });

      const caPath = await this.certManager.ensureCaCertificate();

      const config = vscode.workspace.getConfiguration('cursorAccounts.proxy');
      const maxLogSizeMb = config.get<number>('maxLogSizeMB', 100);

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

      this.childProcesses.set(profileId, {
        childProcess: child,
        port,
        userDataDir: profile.userDataDir,
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        extensionLog.debug(`[Proxy:${profileId}] ${chunk.toString().trim()}`);
      });

      child.on('message', (msg: ProxyChildMessage) => {
        this.handleChildMessage(msg);
      });

      child.on('exit', (code) => {
        extensionLog.warn(
          `[Proxy:${profileId}] Child process exited with code ${code ?? 'unknown'}`
        );
        this.childProcesses.delete(profileId);
        void this.stateStore.clear(profile.userDataDir);
        this.stopLogTailerIfUnused();
        this.notifyStatusChange();
      });

      const ready = await this.waitForReady(child, port);
      if (!ready.success) {
        await this.forceStopChild(profileId);
        return ready;
      }

      const state: ProxyStateFile = {
        version: PROXY_STATE_SCHEMA_VERSION,
        profileId,
        running: true,
        port,
        pid: child.pid,
        startedAt: new Date().toISOString(),
        caCertificatePath: caPath,
        lastUpdatedAt: new Date().toISOString(),
      };
      await this.stateStore.write(profile.userDataDir, state);

      extensionLog.info(
        `[Proxy:${profileId}] Started on 127.0.0.1:${port} (pid ${child.pid})`
      );
      this.outputPresenter?.appendStarted(port);
      await this.ensureLogTailer(profileId, port, { attached: false });
      if (getProxyOutputConfig().autoShowOutputChannel) {
        this.outputPresenter?.show();
      }

      await this.applyProxySettingsForProfile(profile.userDataDir, port);

      this.notifyStatusChange();

      return { success: true, port };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      extensionLog.error(`[Proxy] start failed: ${message}`);
      return { success: false, error: message };
    }
  }

  async stop(profileId: string): Promise<void> {
    try {
      const profile = await this.profileManager.getProfile(profileId);
      if (!profile) {
        return;
      }

      const runtime = this.childProcesses.get(profileId);
      if (runtime?.childProcess.connected) {
        runtime.childProcess.send({ type: 'shutdown' } satisfies ProxyParentMessage);
        await this.waitForExit(runtime.childProcess, PROXY_STOP_TIMEOUT_MS);
      } else {
        const state = await this.stateStore.read(profile.userDataDir);
        if (state?.pid != null) {
          try {
            process.kill(state.pid, 'SIGTERM');
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch {
            // process may already be gone
          }
        }
      }

      await this.forceStopChild(profileId);

      if (this.profileSettingsManager) {
        try {
          await this.profileSettingsManager.restoreProxySettings(profile.userDataDir);
        } catch (error) {
          extensionLog.warn(
            `[Proxy:${profileId}] Failed to restore profile settings: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      await this.stateStore.clear(profile.userDataDir);
      extensionLog.info(`[Proxy:${profileId}] Stopped`);
      this.stopLogTailerIfUnused();
      this.outputPresenter?.appendStopped();
      this.notifyStatusChange();
    } catch (error) {
      extensionLog.error(
        `[Proxy] stop failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getStatus(profileId: string): Promise<ProxyStatus | null> {
    const profile = await this.profileManager.getProfile(profileId);
    if (!profile) {
      return { running: false, logDirectory: this.logDir };
    }

    const state = await this.stateStore.read(profile.userDataDir);
    const runtime = this.childProcesses.get(profileId);

    if (!state) {
      if (runtime) {
        return this.buildStatusFromChild(runtime.port, runtime.childProcess);
      }
      return { running: false, logDirectory: this.logDir };
    }

    const alive = state.pid != null && isProcessAlive(state.pid);
    if (!alive) {
      if (state.running) {
        await this.stateStore.clear(profile.userDataDir);
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
      await this.stateStore.clear(profile.userDataDir);
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

  async isRunning(profileId: string): Promise<boolean> {
    const status = await this.getStatus(profileId);
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
    const profiles = await this.profileManager.getProfiles();
    for (const profile of profiles) {
      const state = await this.stateStore.read(profile.userDataDir);
      if (state?.caCertificatePath) {
        try {
          await fs.access(state.caCertificatePath);
          return state.caCertificatePath;
        } catch {
          // fall through
        }
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

  getOutputPresenter(): ProxyOutputPresenter | undefined {
    return this.outputPresenter;
  }

  async ensureOutputTailer(
    profileId: string,
    options?: { tailFromStart?: boolean }
  ): Promise<void> {
    const status = await this.getStatus(profileId);
    if (!status?.running || status.port == null) {
      return;
    }
    await this.ensureLogTailer(profileId, status.port, {
      attached: !this.childProcesses.has(profileId),
      tailFromStart: options?.tailFromStart,
      forceRestart: options?.tailFromStart === true,
    });
  }

  showOutputChannel(): void {
    const settings = getProxyOutputConfig();
    this.outputPresenter?.show();
    if (!settings.logTrafficToOutput) {
      this.outputPresenter?.appendLogDisabled();
    }
  }

  async getProxyInstallGuide(): Promise<ProxyInstallGuide> {
    const certPath = await this.getCertificatePath();
    return buildProxyInstallGuide({ certPath });
  }

  async checkCertificateInstalled(): Promise<boolean> {
    const installed = await verifyCaCertificateInstalled();
    this.cachedCertificateInstalled = installed;
    return installed;
  }

  getCachedCertificateInstalled(): boolean | undefined {
    return this.cachedCertificateInstalled;
  }

  async installCertificate(): Promise<{ success: boolean; error?: string }> {
    try {
      const certPath = await this.getCertificatePath();
      if (!certPath) {
        return {
          success: false,
          error: 'CA certificate is not available. Start the proxy once to generate it.',
        };
      }
      const alreadyInstalled = await this.checkCertificateInstalled();
      if (alreadyInstalled) {
        return { success: true };
      }
      const result = await this.certManager.installCertificateWithElevation();
      if (result.success) {
        this.cachedCertificateInstalled = true;
      } else {
        const verified = await this.checkCertificateInstalled();
        if (verified) {
          return { success: true };
        }
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  async uninstallCertificate(): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.certManager.uninstallCertificate();
      if (result.success) {
        this.cachedCertificateInstalled = false;
      } else {
        const stillInstalled = await this.checkCertificateInstalled();
        if (!stillInstalled) {
          return { success: true };
        }
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  async getProxyServerUrl(profileId: string): Promise<string | null> {
    const running = await this.isRunning(profileId);
    if (!running) {
      return null;
    }
    const status = await this.getStatus(profileId);
    if (!status?.port) {
      return null;
    }
    return `http://127.0.0.1:${status.port}`;
  }

  async getAllUsedPorts(): Promise<number[]> {
    return await getAllUsedProxyPorts(this.profileManager, this.stateStore);
  }

  async restoreAllProfileProxySettings(): Promise<RestoreAllProfilesResult> {
    if (!this.proxySettingsService) {
      return { restored: 0, errors: [] };
    }
    return await this.proxySettingsService.restoreAllProfiles();
  }

  /**
   * Ensure the current profile's proxy is running and settings are applied.
   * Called when a profile-assigned window activates.
   */
  async ensureProfileProxy(profileId: string): Promise<ProxyStartResult> {
    const running = await this.isRunning(profileId);
    if (running) {
      const status = await this.getStatus(profileId);
      if (status?.port != null) {
        const profile = await this.profileManager.getProfile(profileId);
        if (profile) {
          await this.applyProxySettingsForProfile(profile.userDataDir, status.port);
        }
        await this.ensureOutputTailer(profileId);
      }
      return { success: true, port: status?.port };
    }
    return await this.start(profileId);
  }

  private buildStatusFromChild(
    port: number,
    child: ChildProcess
  ): ProxyStatus {
    return {
      running: true,
      port,
      pid: child.pid,
      logDirectory: this.logDir,
    };
  }

  private handleChildMessage(msg: ProxyChildMessage): void {
    if (msg.type === 'stats') {
      return;
    }
  }

  private async applyProxySettingsForProfile(
    userDataDir: string,
    port: number
  ): Promise<void> {
    if (!this.profileSettingsManager) {
      return;
    }
    const proxyUrl = `http://127.0.0.1:${port}`;
    try {
      await this.profileSettingsManager.applyProxySettings(userDataDir, proxyUrl);
    } catch (error) {
      extensionLog.warn(
        `[Proxy] Failed to apply proxy settings: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async ensureLogTailer(
    profileId: string,
    port: number,
    options: { attached: boolean; tailFromStart?: boolean; forceRestart?: boolean }
  ): Promise<void> {
    if (
      this.logTailer?.isRunning() &&
      this.logTailerStartedForPort === port &&
      !options.forceRestart
    ) {
      return;
    }

    this.stopLogTailer();

    const outputSettings = getProxyOutputConfig();
    if (!outputSettings.logTrafficToOutput) {
      return;
    }

    if (options.attached) {
      this.outputPresenter?.appendAttached(port);
    }

    const tailFromStart =
      options.tailFromStart ??
      vscode.workspace
        .getConfiguration('cursorAccounts.proxy')
        .get<boolean>('outputTailFromStart', false);

    this.logTailer = new ProxyLogTailer(
      this.logDir,
      {
        onTraffic: (summary) => {
          this.outputPresenter?.appendTraffic(summary);
        },
        onError: (summary) => {
          this.outputPresenter?.appendError(summary);
          extensionLog.warn(
            `[Proxy:${profileId}] ${summary.errorKind ?? 'PROXY_ERROR'}: ${summary.errorMessage ?? 'unknown error'}`
          );
        },
        onLogFileResolved: (filePath) => {
          if (filePath) {
            this.outputPresenter?.appendTailing(filePath);
          }
        },
      },
      { tailFromStart }
    );

    this.logTailerStartedForPort = port;
    await this.logTailer.start();
  }

  private stopLogTailer(): void {
    if (this.logTailer) {
      this.logTailer.stop();
      this.logTailer = null;
    }
    this.logTailerStartedForPort = null;
  }

  private stopLogTailerIfUnused(): void {
    if (this.childProcesses.size === 0) {
      this.stopLogTailer();
    }
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

  private async forceStopChild(profileId: string): Promise<void> {
    const runtime = this.childProcesses.get(profileId);
    this.childProcesses.delete(profileId);

    if (!runtime) {
      return;
    }

    const child = runtime.childProcess;
    if (!child.killed && child.pid != null) {
      try {
        child.kill('SIGTERM');
      } catch {
        // already dead
      }
    }
  }
}

export { PROXY_STATE_FILE_NAME };
