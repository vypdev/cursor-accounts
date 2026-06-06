import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
  ProxyStartResult,
  IProxyManager,
  ProxyRuntimeMetadata,
  RestoreAllProfilesResult,
  UpstreamStartOptions,
} from '../domain/ports/IProxyManager';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import type { IProxyCertificateService } from '../domain/ports/IProxyCertificateService';
import type { IProxyProcess } from '../domain/ports/IProxyProcess';
import type { IProxyTrafficBus, TrafficListener } from '../domain/ports/IProxyTrafficBus';
import type { IProxyTrafficIngress } from '../domain/ports/IProxyTrafficIngress';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import {
  isProfileProxyJsonlLoggingEnabled,
  type ProxyInstallGuide,
  type ProxyStateFile,
  type ProxyStatus,
  type ProxyTrafficDiagnostics,
  type Profile,
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
import { createAgentTrackingRepository } from '../persistence/agentTrackingRepositoryFactory';
import { getEfficiencyDbPath } from '../persistence/efficiencyDatabase';
import { ProxyLiveCostCalculator } from '../domain/services/ProxyLiveCostCalculator';
import { TokenTurnDetectionService } from '../domain/services/tokenTurnDetectionService';
import { CursorModelPricingProvider } from '../modelEfficiency/cursorModelPricingProvider';
import { AgentTrackingService } from './agentTrackingService';
import { ProxyCertificateService } from './proxyCertificateService';
import type { ProxySettingsService } from './proxySettingsService';

export type ProxyTrafficListener = TrafficListener;

export interface ConversationUsagePersistedEvent {
  conversationId: string;
  profileId: string;
}

export type ConversationUsagePersistedListener = (
  event: ConversationUsagePersistedEvent
) => void;

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
  private readonly runtimeMetadata = new Map<string, ProxyRuntimeMetadata>();
  private readonly statusCallbacks: Array<() => void> = [];
  private readonly usagePersistedListeners: ConversationUsagePersistedListener[] =
    [];
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

    this.deps.trafficBus.subscribe((summary, profileId, workspacePath) => {
      void this.handleTraffic(summary, profileId, workspacePath);
    });
  }

  getRuntimeMetadata(runtimeId: string): ProxyRuntimeMetadata | undefined {
    return this.runtimeMetadata.get(runtimeId);
  }

  private async handleTraffic(
    summary: Parameters<TrafficListener>[0],
    profileId?: string,
    workspacePath?: string
  ): Promise<void> {
    const agent = summary.insights?.agent;
    const isAgentTraffic =
      summary.isLiveTokenUpdate === true ||
      summary.isTurnEnded === true ||
      agent?.usageEvent != null ||
      (summary.insights?.allTokenFrames?.length ?? 0) > 0;

    if (isAgentTraffic) {
      const bidi = agent?.requestId;
      const conv =
        agent?.conversationId ?? summary.insights?.context?.conversationId;
      extensionLog.info(
        `[AgentTracking] proxy recv profile=${profileId ?? '(none)'} ` +
          `live=${summary.isLiveTokenUpdate === true} turnEnded=${summary.isTurnEnded === true} ` +
          `bidi=${bidi ? `${bidi.slice(0, 8)}…` : '(none)'} ` +
          `conv=${conv ? `${conv.slice(0, 8)}…` : '(none)'} ` +
          `usage=${agent?.usageEvent ?? '(none)'} ` +
          `delta=${summary.liveTokenData?.latestDelta ?? '(none)'} ` +
          `endpoint=${summary.endpoint ?? summary.url}`
      );
    }

    if (profileId) {
      await this.ensureAgentTrackingForProfile(profileId);
      const tracking = this.agentTrackingServices.get(profileId);
      if (!tracking && isAgentTraffic) {
        extensionLog.warn(
          `[AgentTracking] no AgentTrackingService for profile=${profileId}`
        );
      }
      const result = await tracking?.ingestTraffic(summary, workspacePath);
      if (isAgentTraffic) {
        extensionLog.info(
          `[AgentTracking] ingest result profile=${profileId} ` +
            `delta=${result?.deltaPersisted === true} ` +
            `turnEnded=${result?.turnEndedPersisted === true} ` +
            `context=${result?.contextPersisted === true} ` +
            `conv=${result?.conversationId ? `${result.conversationId.slice(0, 8)}…` : '(none)'}`
        );
      }
      if (
        result &&
        (result.deltaPersisted ||
          result.turnEndedPersisted ||
          result.contextPersisted)
      ) {
        for (const listener of this.usagePersistedListeners) {
          try {
            listener({
              conversationId: result.conversationId,
              profileId,
            });
          } catch (error) {
            extensionLog.debug(
              `[Proxy] usage persisted listener error: ${extensionLog.formatError(error)}`
            );
          }
        }
      }
    } else if (isAgentTraffic) {
      extensionLog.warn(
        '[AgentTracking] agent traffic without profileId — ingest skipped'
      );
    }
    this.tokenDetectorPresenter?.appendTraffic(summary, profileId);
    if (getProxyOutputConfig().logTrafficToOutput) {
      this.outputPresenter?.appendTraffic(summary);
    }
  }

  onStatusChange(callback: () => void): void {
    this.statusCallbacks.push(callback);
  }

  onTraffic(listener: ProxyTrafficListener): void {
    this.deps.trafficBus.subscribe(listener);
  }

  onConversationUsagePersisted(
    listener: ConversationUsagePersistedListener
  ): void {
    this.usagePersistedListeners.push(listener);
  }

  getAgentTrackingService(profileId: string): AgentTrackingService | undefined {
    return this.agentTrackingServices.get(profileId);
  }

  private isProfileJsonlLogging(profile: Profile): boolean {
    return isProfileProxyJsonlLoggingEnabled(profile);
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
      const serverConfig = this.buildServerConfig(port, profile);

      const proxyProcess = this.deps.createProcess();
      proxyProcess.onStderr((line) => {
        if (line.includes('[AgentTracking]')) {
          extensionLog.info(`[Proxy:${profileId}] ${line}`);
        } else {
          extensionLog.debug(`[Proxy:${profileId}] ${line}`);
        }
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
      } else {
        this.deps.trafficIngress.stop(profileId);
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

  async startUpstream(
    upstreamId: string,
    options: UpstreamStartOptions
  ): Promise<ProxyStartResult> {
    try {
      const profile = await this.profileManager.getProfile(options.profileId);
      if (!profile) {
        return {
          success: false,
          error: `Profile ${options.profileId} not found`,
        };
      }

      const existing = this.runtimes.get(upstreamId);
      if (existing) {
        return { success: true, port: existing.port };
      }

      let port: number | undefined = options.preferredPort;
      if (port == null || !(await isPortAvailable(port))) {
        port = (await this.findAvailableUpstreamPort(options.preferredPort)) ?? undefined;
      }
      if (port == null) {
        return { success: false, error: 'No available port for upstream proxy' };
      }

      await fs.mkdir(this.storageDir, { recursive: true });
      await fs.mkdir(this.logDir, { recursive: true });

      await this.deps.certService.ensureCaCertificate();
      const serverConfig = this.buildServerConfig(port, profile);

      const proxyProcess = this.deps.createProcess();
      proxyProcess.onMessage((msg: ProxyChildMessage) => {
        this.handleChildMessage(upstreamId, msg);
      });
      proxyProcess.onExit(() => {
        this.runtimes.delete(upstreamId);
        this.runtimeMetadata.delete(upstreamId);
        this.notifyStatusChange();
      });

      const runtime = await proxyProcess.start(serverConfig);
      const ready = await proxyProcess.waitForReady(port, PROXY_START_TIMEOUT_MS);
      if (!ready.success) {
        await proxyProcess.stop(runtime.pid);
        return ready;
      }

      this.runtimes.set(upstreamId, {
        process: proxyProcess,
        port,
        userDataDir: profile.userDataDir,
      });
      this.runtimeMetadata.set(upstreamId, {
        profileId: options.profileId,
        workspacePath: options.workspacePath,
      });

      await this.ensureAgentTracking(options.profileId, profile.userDataDir);

      extensionLog.info(
        `[Proxy:${upstreamId}] Upstream started on 127.0.0.1:${port} workspace=${options.workspacePath}`
      );
      this.notifyStatusChange();
      return { success: true, port };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      extensionLog.error(`[Proxy] startUpstream failed: ${message}`);
      return { success: false, error: message };
    }
  }

  private async findAvailableUpstreamPort(
    preferred?: number
  ): Promise<number | null> {
    if (preferred != null && (await isPortAvailable(preferred))) {
      return preferred;
    }
    for (let port = 8000; port < 9000; port++) {
      if (await isPortAvailable(port)) {
        return port;
      }
    }
    return null;
  }

  async stopUpstream(upstreamId: string): Promise<void> {
    const runtime = this.runtimes.get(upstreamId);
    if (!runtime) {
      return;
    }

    try {
      if (runtime.process.isConnected()) {
        await runtime.process.sendShutdown(PROXY_STOP_TIMEOUT_MS);
      }

      await this.forceStopChild(upstreamId);
      this.deps.trafficIngress.stop(upstreamId);
      extensionLog.info(`[Proxy:${upstreamId}] Upstream stopped`);
      this.notifyStatusChange();
    } catch (error) {
      extensionLog.error(
        `[Proxy] stopUpstream failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async stop(
    profileId: string,
    options?: { restoreSettings?: boolean }
  ): Promise<void> {
    const restoreSettings = options?.restoreSettings !== false;
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

      if (restoreSettings && this.profileSettingsManager) {
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

  async restartProfileProxy(profileId: string): Promise<ProxyStartResult> {
    const profile = await this.profileManager.getProfile(profileId);
    if (!profile) {
      return { success: false, error: `Profile ${profileId} not found` };
    }

    if (!(await this.isRunning(profileId))) {
      return { success: true };
    }

    extensionLog.info(
      `[Proxy:${profileId}] Restarting proxy after JSONL logging change`
    );
    await this.stop(profileId, { restoreSettings: false });
    return await this.start(profileId);
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

    const profile = await this.profileManager.getProfile(profileId);
    const jsonlTail = profile ? this.isProfileJsonlLogging(profile) : false;

    const attached = !this.runtimes.has(profileId) || options?.forceRestart === true;
    if (attached && getProxyOutputConfig().logTrafficToOutput) {
      this.outputPresenter?.appendAttached(status.port);
    }

    if (!jsonlTail) {
      this.deps.trafficIngress.stop(profileId);
      return;
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
    for (const [profileId] of this.runtimes) {
      const profile = await this.profileManager.getProfile(profileId);
      if (profile && this.isProfileJsonlLogging(profile)) {
        const runtime = this.runtimes.get(profileId);
        if (runtime) {
          await this.deps.trafficIngress.start(profileId, runtime.port, {
            ipc: true,
            jsonlTail: true,
          });
        }
        return;
      }
    }

    const profiles = await this.profileManager.getProfiles();
    for (const profile of profiles) {
      if (!this.isProfileJsonlLogging(profile)) {
        continue;
      }
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

  private buildServerConfig(port: number, profile: Profile): ProxyServerConfig {
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
      developmentMode: this.isProfileJsonlLogging(profile),
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
      const metadata = this.runtimeMetadata.get(profileId);
      this.deps.trafficBus.publish(
        msg.summary,
        metadata?.profileId ?? profileId,
        metadata?.workspacePath
      );
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

  private async ensureAgentTrackingForProfile(profileId: string): Promise<void> {
    if (this.agentTrackingServices.has(profileId)) {
      return;
    }
    const profile = await this.profileManager.getProfile(profileId);
    if (!profile) {
      return;
    }
    await this.ensureAgentTracking(profileId, profile.userDataDir);
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
      const repository = createAgentTrackingRepository(
        dbPath,
        this.context.extensionPath
      );
      const turnDetectionService = new TokenTurnDetectionService();
      const liveCostCalculator = new ProxyLiveCostCalculator(
        new CursorModelPricingProvider(),
        () =>
          vscode.workspace
            .getConfiguration('cursorAccounts.proxy')
            .get<number>('estimatedDollarsPerMillionTokens', 4)
      );
      const service = new AgentTrackingService(
        repository,
        profileId,
        turnDetectionService,
        liveCostCalculator
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
    this.runtimeMetadata.delete(profileId);
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
