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
import type { IProxyCertificateService } from '../domain/ports/IProxyCertificateService';
import type { IProxyProcess } from '../domain/ports/IProxyProcess';
import type { IProxyTrafficBus, TrafficListener } from '../domain/ports/IProxyTrafficBus';
import type { IProxyTrafficIngress } from '../domain/ports/IProxyTrafficIngress';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import type {
  ProxyInstallGuide,
  ProxyStateFile,
  ProxyStatus,
  ProxyTrafficDiagnostics,
} from '@cursor-accounts/types';
import type { ProxyServerConfig } from '../application/types/proxyConfig';
import type { ProxyChildMessage } from '../application/types/proxyTraffic';
import { createProxyCostEnricher } from '../application/services/proxyCostEnricher';
import { ProxyTrafficBus } from '../application/services/proxyTrafficBus';
import { ProxyTrafficIngress } from '../application/services/proxyTrafficIngress';
import { formatDiagnosticsSummaryLines } from '../proxy/proxyTrafficDiagnostics';
import { getProxyOutputConfig } from '../proxy/proxyOutputPresenter';
import type { ProxyOutputPresenter } from '../proxy/proxyOutputPresenter';
import type { TokenDetectorOutputPresenter } from '../proxy/tokenDetectorOutputPresenter';
import * as extensionLog from '../logging/extensionLog';
import { CertificateManager } from '../proxy/certificateManager';
import { getSharedProxyStorageDir } from '../proxy/sharedProxyPaths';
import { NodeProxyProcess } from '../proxy/nodeProxyProcess';
import { isPortAvailable, isProcessAlive } from '../proxy/portUtils';
import {
  getAllUsedProxyPorts,
  resolvePortForProfile,
} from '../proxy/resolvePortForProfile';
import {
  PROXY_STATE_SCHEMA_VERSION,
  PROXY_STATE_FILE_NAME,
} from '../proxy/types';
import { AgentTrackingDatabase } from '../persistence/agentTrackingDatabase';
import { getEfficiencyDbPath } from '../persistence/efficiencyDatabase';
import { TokenTurnDetectionService } from '../domain/services/tokenTurnDetectionService';
import { AgentTrackingService } from './agentTrackingService';
import { ProxyCertificateService } from './proxyCertificateService';
import type { ProxySettingsService } from './proxySettingsService';

export type ProxyTrafficListener = TrafficListener;

const PROXY_START_TIMEOUT_MS = 15_000;
const PROXY_STOP_TIMEOUT_MS = 5_000;

interface ProfileProxyRuntime {
  process: IProxyProcess;
  port: number;
  userDataDir: string;
}

export interface ProxyManagerDependencies {
  certService: IProxyCertificateService;
  trafficBus: IProxyTrafficBus;
  trafficIngress: IProxyTrafficIngress;
  createProcess: () => IProxyProcess;
}

function defaultDependencies(
  storageDir: string,
  logDir: string,
  stateStore: IProxyStateStore,
  profileManager: IProfileManager,
  extensionPath: string,
  outputPresenter?: ProxyOutputPresenter,
  _tokenDetectorPresenter?: TokenDetectorOutputPresenter
): ProxyManagerDependencies {
  const certManager = new CertificateManager(path.join(storageDir, 'certs'));
  const trafficBus = new ProxyTrafficBus(
    createProxyCostEnricher(() =>
      vscode.workspace
        .getConfiguration('cursorAccounts.proxy')
        .get<number>('estimatedDollarsPerMillionTokens', 4)
    )
  );

  const trafficIngress = new ProxyTrafficIngress(
    logDir,
    trafficBus,
    () =>
      vscode.workspace
        .getConfiguration('cursorAccounts.proxy')
        .get<boolean>('outputTailFromStart', false),
    {
      onLogFileResolved: (filePath) => {
        if (filePath) {
          outputPresenter?.appendTailing(filePath);
        }
      },
      onTailerError: (profileId, summary) => {
        extensionLog.warn(
          `[Proxy:${profileId}] ${summary.errorKind ?? 'PROXY_ERROR'}: ${summary.errorMessage ?? 'unknown error'}`
        );
      },
    }
  );

  const scriptPath = path.join(extensionPath, 'out', 'proxy', 'proxyServer.js');

  return {
    certService: new ProxyCertificateService(
      certManager,
      stateStore,
      profileManager
    ),
    trafficBus,
    trafficIngress,
    createProcess: () => new NodeProxyProcess(scriptPath, extensionPath),
  };
}

/**
 * Facade for per-profile MITM proxy lifecycle, certificates, and traffic distribution.
 */
export class ProxyManager implements IProxyManager {
  private readonly runtimes = new Map<string, ProfileProxyRuntime>();
  private readonly statusCallbacks: Array<() => void> = [];
  private readonly agentTrackingServices = new Map<string, AgentTrackingService>();
  private readonly storageDir: string;
  private readonly logDir: string;
  private lastDiagnosticsOutputAt = 0;

  constructor(
    private readonly stateStore: IProxyStateStore,
    private readonly profileManager: IProfileManager,
    private readonly context: vscode.ExtensionContext,
    storageDir: string = getSharedProxyStorageDir(),
    private readonly proxySettingsService?: ProxySettingsService,
    private readonly profileSettingsManager?: IProfileSettingsManager,
    private readonly outputPresenter?: ProxyOutputPresenter,
    private readonly tokenDetectorPresenter?: TokenDetectorOutputPresenter,
    private readonly deps: ProxyManagerDependencies = defaultDependencies(
      storageDir,
      path.join(storageDir, 'logs'),
      stateStore,
      profileManager,
      context.extensionPath,
      outputPresenter,
      tokenDetectorPresenter
    )
  ) {
    this.storageDir = storageDir;
    this.logDir = path.join(this.storageDir, 'logs');

    this.deps.trafficBus.subscribe((summary, profileId) => {
      if (profileId) {
        void this.agentTrackingServices.get(profileId)?.ingestTraffic(summary);
      }
      this.tokenDetectorPresenter?.appendTraffic(summary, profileId);
      if (getProxyOutputConfig().logTrafficToOutput) {
        this.outputPresenter?.appendTraffic(summary);
      }
    });
  }

  onStatusChange(callback: () => void): void {
    this.statusCallbacks.push(callback);
  }

  onTraffic(listener: ProxyTrafficListener): void {
    this.deps.trafficBus.subscribe(listener);
  }

  private isProxyDevelopmentMode(): boolean {
    return vscode.workspace
      .getConfiguration('cursorAccounts.proxy')
      .get<boolean>('developmentMode', false);
  }

  async start(profileId: string): Promise<ProxyStartResult> {
    try {
      const profile = await this.profileManager.getProfile(profileId);
      if (!profile) {
        return { success: false, error: `Profile ${profileId} not found` };
      }

      const existing = await this.getStatus(profileId);
      if (existing?.running && existing.port != null) {
        await this.ensureAgentTracking(profileId, profile.userDataDir);
        await this.applyProxySettingsForProfile(profile.userDataDir, existing.port);
        await this.ensureOutputTailer(profileId, { forceRestart: true });
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

      const caPath = await this.deps.certService.ensureCaCertificate();
      const serverConfig = this.buildServerConfig(port);

      const proxyProcess = this.deps.createProcess();
      proxyProcess.onStderr((line) => {
        extensionLog.debug(`[Proxy:${profileId}] ${line}`);
      });

      proxyProcess.onMessage((msg: ProxyChildMessage) => {
        this.handleChildMessage(profileId, msg);
      });

      proxyProcess.onExit((code) => {
        extensionLog.warn(
          `[Proxy:${profileId}] Child process exited with code ${code ?? 'unknown'}`
        );
        this.runtimes.delete(profileId);
        void this.stateStore.clear(profile.userDataDir);
        this.deps.trafficIngress.stopAll();
        this.notifyStatusChange();
      });

      const runtime = await proxyProcess.start(serverConfig);
      const ready = await proxyProcess.waitForReady(port, PROXY_START_TIMEOUT_MS);
      if (!ready.success) {
        await proxyProcess.stop(runtime.pid);
        if (proxyProcess instanceof NodeProxyProcess) {
          proxyProcess.detach();
        }
        return ready;
      }

      this.runtimes.set(profileId, {
        process: proxyProcess,
        port,
        userDataDir: profile.userDataDir,
      });

      const state: ProxyStateFile = {
        version: PROXY_STATE_SCHEMA_VERSION,
        profileId,
        running: true,
        port,
        pid: runtime.pid,
        startedAt: new Date().toISOString(),
        caCertificatePath: caPath,
        lastUpdatedAt: new Date().toISOString(),
      };
      await this.stateStore.write(profile.userDataDir, state);

      extensionLog.info(
        `[Proxy:${profileId}] Started on 127.0.0.1:${port} (pid ${runtime.pid})`
      );
      this.outputPresenter?.appendStarted(port);
      await this.ensureAgentTracking(profileId, profile.userDataDir);

      if (serverConfig.developmentMode) {
        await this.deps.trafficIngress.start(profileId, port, {
          ipc: true,
          jsonlTail: true,
        });
      }

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

      const runtime = this.runtimes.get(profileId);
      if (runtime?.process.isConnected()) {
        await runtime.process.sendShutdown(PROXY_STOP_TIMEOUT_MS);
      } else {
        const state = await this.stateStore.read(profile.userDataDir);
        await runtime?.process.stop(state?.pid, 'SIGTERM');
      }

      await this.forceStopChild(profileId);
      this.deps.trafficIngress.stop(profileId);

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
    const runtime = this.runtimes.get(profileId);

    if (!state) {
      if (runtime) {
        return {
          running: true,
          port: runtime.port,
          pid: runtime.process instanceof NodeProxyProcess
            ? runtime.process.getChild()?.pid
            : undefined,
          logDirectory: this.logDir,
        };
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
    return this.deps.certService.getCertificatePath();
  }

  getLogDirectory(): string {
    return this.logDir;
  }

  showTokenDetectorChannel(): void {
    this.tokenDetectorPresenter?.show();
  }

  async ensureOutputTailer(
    profileId: string,
    options?: { tailFromStart?: boolean; forceRestart?: boolean }
  ): Promise<void> {
    const status = await this.getStatus(profileId);
    if (!status?.running || status.port == null) {
      return;
    }

    const attached = !this.runtimes.has(profileId) || options?.forceRestart === true;
    if (attached && getProxyOutputConfig().logTrafficToOutput) {
      this.outputPresenter?.appendAttached(status.port);
    }

    await this.deps.trafficIngress.start(
      profileId,
      status.port,
      { ipc: true, jsonlTail: true },
      {
        attached,
        tailFromStart: options?.tailFromStart,
        forceRestart: options?.forceRestart,
      }
    );
  }

  async ensureTrafficTailer(): Promise<void> {
    if (!this.isProxyDevelopmentMode()) {
      return;
    }

    for (const [profileId, runtime] of this.runtimes) {
      await this.deps.trafficIngress.start(profileId, runtime.port, {
        ipc: true,
        jsonlTail: true,
      });
      return;
    }

    const profiles = await this.profileManager.getProfiles();
    for (const profile of profiles) {
      if (!(await this.isRunning(profile.id))) {
        continue;
      }
      const status = await this.getStatus(profile.id);
      if (status?.port != null) {
        await this.deps.trafficIngress.start(profile.id, status.port, {
          ipc: true,
          jsonlTail: true,
        });
        return;
      }
    }
  }

  showOutputChannel(): void {
    const settings = getProxyOutputConfig();
    this.outputPresenter?.show();
    if (!settings.logTrafficToOutput) {
      this.outputPresenter?.appendLogDisabled();
    }
  }

  async getProxyInstallGuide(): Promise<ProxyInstallGuide> {
    return this.deps.certService.getInstallGuide();
  }

  async checkCertificateInstalled(): Promise<boolean> {
    return this.deps.certService.checkInstalled();
  }

  getCachedCertificateInstalled(): boolean | undefined {
    return this.deps.certService.getCachedInstalled();
  }

  async installCertificate(): Promise<{ success: boolean; error?: string }> {
    return this.deps.certService.install();
  }

  async uninstallCertificate(): Promise<{ success: boolean; error?: string }> {
    return this.deps.certService.uninstall();
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

  async ensureProfileProxy(profileId: string): Promise<ProxyStartResult> {
    const running = await this.isRunning(profileId);
    if (running) {
      const status = await this.getStatus(profileId);
      if (status?.port != null) {
        const profile = await this.profileManager.getProfile(profileId);
        if (profile) {
          await this.ensureAgentTracking(profileId, profile.userDataDir);
          await this.applyProxySettingsForProfile(profile.userDataDir, status.port);
        }
        await this.ensureOutputTailer(profileId, { forceRestart: true });
      }
      return { success: true, port: status?.port };
    }
    return await this.start(profileId);
  }

  private buildServerConfig(port: number): ProxyServerConfig {
    const config = vscode.workspace.getConfiguration('cursorAccounts.proxy');
    const maxLogSizeMb = config.get<number>('maxLogSizeMB', 500);
    const maxBodyLogMb = config.get<number>('maxBodyLogMB', 4);
    return {
      port,
      storageDir: this.storageDir,
      logDir: this.logDir,
      maxLogSizeMb,
      maxBodyLogBytes: Math.max(1, Math.floor(maxBodyLogMb * 1024 * 1024)),
      spillLargeBodies: config.get<boolean>('spillLargeBodies', true),
      developmentMode: config.get<boolean>('developmentMode', false),
      trafficDiagnostics: config.get<boolean>('trafficDiagnostics', true),
      diagnosticsIntervalMs: config.get<number>('diagnosticsIntervalMs', 30_000),
    };
  }

  private handleChildMessage(profileId: string, msg: ProxyChildMessage): void {
    if (msg.type === 'stats') {
      this.maybeEmitDiagnosticsSummary(msg.data.diagnostics);
      return;
    }
    if (msg.type === 'traffic') {
      this.deps.trafficBus.publish(msg.summary, profileId);
    }
  }

  private maybeEmitDiagnosticsSummary(
    diagnostics: ProxyTrafficDiagnostics | undefined
  ): void {
    if (!diagnostics) {
      return;
    }

    const config = vscode.workspace.getConfiguration('cursorAccounts.proxy');
    if (!config.get<boolean>('trafficDiagnostics', true)) {
      return;
    }

    const intervalMs = config.get<number>('diagnosticsIntervalMs', 30_000);
    const now = Date.now();
    if (now - this.lastDiagnosticsOutputAt < intervalMs - 2_000) {
      return;
    }
    this.lastDiagnosticsOutputAt = now;

    const lines = formatDiagnosticsSummaryLines(diagnostics);
    this.outputPresenter?.appendDiagnostics(lines);
  }

  private async ensureAgentTracking(
    profileId: string,
    userDataDir: string
  ): Promise<void> {
    if (this.agentTrackingServices.has(profileId)) {
      return;
    }

    try {
      const dbPath = getEfficiencyDbPath(userDataDir);
      const repository = new AgentTrackingDatabase(
        dbPath,
        this.context.extensionPath
      );
      const turnDetectionService = new TokenTurnDetectionService();
      const service = new AgentTrackingService(
        repository,
        profileId,
        turnDetectionService
      );
      await service.initialize();
      this.agentTrackingServices.set(profileId, service);
      this.tokenDetectorPresenter?.appendInitialized(profileId);
    } catch (error) {
      extensionLog.error(
        `[AgentTracking] Failed to initialize for ${profileId}: ${extensionLog.formatError(error)}`
      );
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

  private notifyStatusChange(): void {
    for (const cb of this.statusCallbacks) {
      try {
        cb();
      } catch (error) {
        extensionLog.debug(
          `[Proxy] status callback error: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  private async forceStopChild(profileId: string): Promise<void> {
    const runtime = this.runtimes.get(profileId);
    this.runtimes.delete(profileId);
    this.agentTrackingServices.delete(profileId);

    if (!runtime) {
      return;
    }

    const nodeProcess =
      runtime.process instanceof NodeProxyProcess
        ? runtime.process
        : null;
    const pid =
      nodeProcess?.getChild()?.pid ??
      (await this.stateStore.read(runtime.userDataDir))?.pid;

    await runtime.process.stop(pid);
    nodeProcess?.detach();
  }
}

export { PROXY_STATE_FILE_NAME };
