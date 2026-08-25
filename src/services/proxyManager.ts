import * as path from 'path';
import * as vscode from 'vscode';
import type {
  ProxyStartResult,
  IProxyManager,
  RestoreAllProfilesResult,
} from '../domain/ports/IProxyManager';
import type {
  ConversationUsagePersistedEvent,
  ConversationUsagePersistedListener,
  ProxyTrafficListener,
} from '../domain/ports/IProxyTraffic';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import type { TrafficListener } from '../domain/ports/IProxyTrafficBus';
import type {
  IProxyOutputPresenter,
  ITokenDetectorOutputPresenter,
  ProxyOutputSettings,
} from '../domain/ports/IProxyOutputPresenter';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import {
  isProfileProxyEnabled,
  type ProxyInstallGuide,
  type ProxyStateFile,
  type ProxyStatus,
  type ProxyTrafficDiagnostics,
  type Profile,
} from '@cursor-accounts/types';
import type { ProxyServerConfig } from '../application/types/proxyConfig';
import { formatDiagnosticsSummaryLines } from '../proxy/proxyTrafficDiagnostics';
import * as extensionLog from '../logging/extensionLog';
import { getSharedProxyStorageDir } from '../proxy/sharedProxyPaths';
import { NodeProxyProcess } from '../proxy/nodeProxyProcess';
import {
  buildProxyApiBaseUrl,
  ProxyApiClient,
  resolveProxyApiPort,
} from '../proxy/api/proxyApiClient';
import { SharedProxyStateStore } from '../proxy/sharedProxyStateStore';
import { isPortAvailable } from '../proxy/portUtils';
import {
  getAllUsedProxyPorts,
} from '../proxy/resolvePortForProfile';
import {
  PROXY_STATE_FILE_NAME,
  SHARED_PROXY_RUNTIME_KEY,
  SHARED_PROXY_STATE_FILE_NAME,
} from '../proxy/types';
import type { AgentTrackingService } from './agentTrackingService';
import {
  createDefaultProxyManagerDependencies,
  type ProxyManagerDependencies,
} from './proxyManagerDefaultDependencies';
import { ProxyAgentTrackingCoordinator } from './proxyAgentTrackingCoordinator';
import { ProxyTrafficIngressCoordinator } from './proxyTrafficIngressCoordinator';
import { ProxyTrafficUsageCoordinator } from './proxyTrafficUsageCoordinator';
import {
  ProxyProfileLifecycleCoordinator,
} from './proxyProfileLifecycleCoordinator';
import {
  SharedProxyLifecycleCoordinator,
  type SharedProxyRuntime,
} from './sharedProxyLifecycleCoordinator';
import { ProxyStatusCoordinator } from './proxyStatusCoordinator';
import {
  ProxyTrafficTailerCoordinator,
  type ProxyTrafficTailerOptions,
} from './proxyTrafficTailerCoordinator';
import { ProxyProfileRoutingConfiguration } from './proxyProfileRoutingConfiguration';
import { ProxyChildProcessStopCoordinator } from './proxyChildProcessStopCoordinator';
import { ProxyServerConfigurationBuilder } from './proxyServerConfigurationBuilder';
import { ProxyManagerOutputCoordinator } from './proxyManagerOutputCoordinator';
import type { ProxySettingsService } from './proxySettingsService';

export type { ConversationUsagePersistedEvent, ConversationUsagePersistedListener, ProxyTrafficListener } from '../domain/ports/IProxyTraffic';

type ProfileProxyRuntime = SharedProxyRuntime;

export type { ProxyManagerDependencies } from './proxyManagerDefaultDependencies';

/**
 * Facade for per-profile MITM proxy lifecycle, certificates, and traffic distribution.
 */
export class ProxyManager implements IProxyManager {
  private readonly runtimes = new Map<string, ProfileProxyRuntime>();
  private readonly statusCallbacks: Array<() => void> = [];
  private readonly usagePersistedListeners: ConversationUsagePersistedListener[] =
    [];
  private agentTrackingCoordinator!: ProxyAgentTrackingCoordinator;
  private trafficIngressCoordinator!: ProxyTrafficIngressCoordinator;
  private trafficUsageCoordinator!: ProxyTrafficUsageCoordinator;
  private sharedProxyLifecycleCoordinator!: SharedProxyLifecycleCoordinator;
  private profileLifecycleCoordinator!: ProxyProfileLifecycleCoordinator;
  private statusCoordinator!: ProxyStatusCoordinator;
  private trafficTailerCoordinator!: ProxyTrafficTailerCoordinator;
  private profileRoutingConfiguration!: ProxyProfileRoutingConfiguration;
  private childProcessStopCoordinator!: ProxyChildProcessStopCoordinator;
  private readonly serverConfigurationBuilder: ProxyServerConfigurationBuilder;
  private readonly sharedProxyStateStore: SharedProxyStateStore;
  private outputCoordinator!: ProxyManagerOutputCoordinator;
  private readonly storageDir: string;
  private readonly logDir: string;
  private lastDiagnosticsOutputAt = 0;
  private readonly deps: ProxyManagerDependencies;
  private readonly getOutputConfig: () => ProxyOutputSettings;

  constructor(
    private readonly stateStore: IProxyStateStore,
    private readonly profileManager: IProfileReader,
    private readonly context: vscode.ExtensionContext,
    storageDir: string = getSharedProxyStorageDir(),
    private readonly proxySettingsService?: ProxySettingsService,
    private readonly profileSettingsManager?: IProfileSettingsManager,
    private readonly outputPresenter?: IProxyOutputPresenter,
    private readonly tokenDetectorPresenter?: ITokenDetectorOutputPresenter,
    deps?: ProxyManagerDependencies,
    getOutputConfig?: () => ProxyOutputSettings
  ) {
    this.storageDir = storageDir;
    this.logDir = path.join(this.storageDir, 'logs');
    this.sharedProxyStateStore = new SharedProxyStateStore(
      path.join(this.storageDir, SHARED_PROXY_STATE_FILE_NAME)
    );
    this.deps =
      deps ??
      createDefaultProxyManagerDependencies({
        storageDir,
        logDir: this.logDir,
        extensionPath: context.extensionPath,
        context,
        stateStore,
        profileManager,
        outputPresenter,
        getEstimatedDollarsPerMillionTokens: () =>
          vscode.workspace
            .getConfiguration('cursorAccounts.proxy')
            .get<number>('estimatedDollarsPerMillionTokens', 4),
        getTailFromStart: () =>
          vscode.workspace
            .getConfiguration('cursorAccounts.proxy')
            .get<boolean>('outputTailFromStart', false),
        onDiagnostics: (diagnostics) =>
          this.maybeEmitDiagnosticsSummary(diagnostics),
      });
    this.getOutputConfig =
      getOutputConfig ??
      (() => {
        const config = vscode.workspace.getConfiguration('cursorAccounts.proxy');
        return {
          logTrafficToOutput: config.get<boolean>('logTrafficToOutput', true),
          autoShowOutputChannel: config.get<boolean>('autoShowOutputChannel', false),
          outputCursorHostsOnly: config.get<boolean>('outputCursorHostsOnly', false),
        };
      });
    this.serverConfigurationBuilder = new ProxyServerConfigurationBuilder({
      storageDir: this.storageDir,
      logDir: this.logDir,
      getConfig: (key, fallback) =>
        vscode.workspace
          .getConfiguration('cursorAccounts.proxy')
          .get(key, fallback),
      isJsonlLoggingEnabled: (profile) => profile.proxyJsonlLoggingEnabled === true,
    });
    this.initializeTrafficCoordinators();
    this.initializeLifecycleCoordinators();
    this.initializeReadModelCoordinators();
    this.initializeStopCoordinator();
    this.deps.trafficBus.subscribe((summary, profileId) => {
      void this.handleTraffic(summary, profileId);
    });
  }

  private initializeTrafficCoordinators(): void {
    this.agentTrackingCoordinator = new ProxyAgentTrackingCoordinator(
      this.context.extensionPath,
      () =>
        vscode.workspace
          .getConfiguration('cursorAccounts.proxy')
          .get<number>('estimatedDollarsPerMillionTokens', 4),
      {
        onInitialized: (profileId) =>
          this.tokenDetectorPresenter?.appendInitialized(profileId),
      }
    );
    this.trafficIngressCoordinator = new ProxyTrafficIngressCoordinator({
      profileManager: this.profileManager,
      trafficIngress: this.deps.trafficIngress,
      outputPresenter: this.outputPresenter,
      getOutputConfig: this.getOutputConfig,
      hasRuntime: (profileId) => this.runtimes.has(profileId),
      sharedRuntimeKey: SHARED_PROXY_RUNTIME_KEY,
    });
    this.trafficUsageCoordinator = new ProxyTrafficUsageCoordinator({
      isSharedProxyActive: () => this.isSharedProxyActive(),
      ensureAgentTracking: (profileId) =>
        this.ensureAgentTrackingForProfile(profileId),
      getAgentTrackingService: (profileId) =>
        this.agentTrackingCoordinator.get(profileId),
      onUsagePersisted: (event) => this.notifyUsagePersisted(event),
    });
  }

  private initializeLifecycleCoordinators(): void {
    this.sharedProxyLifecycleCoordinator =
      new SharedProxyLifecycleCoordinator({
        storageDir: this.storageDir,
        logDir: this.logDir,
        stateStore: this.sharedProxyStateStore,
        certService: this.deps.certService,
        createProcess: this.deps.createProcess,
        isPortAvailable: (port) => isPortAvailable(port),
        createApiClient: (apiPort, apiToken) =>
          this.createApiClient(apiPort, apiToken),
        resolveApiPort: (mitmPort, persistedApiPort) =>
          this.resolveApiPort(mitmPort, persistedApiPort),
        buildServerConfig: (port, profile, overrides) =>
          this.buildServerConfig(port, profile, {
            ...overrides,
            extensionPath: this.context.extensionPath,
          }),
        buildUserIdMapping: (profiles) => this.buildUserIdMapping(profiles),
        buildProfileDbPaths: (profiles) => this.buildProfileDbPaths(profiles),
        prepareProfile: async (profile, port) => {
          await this.ensureAgentTracking(profile.id, profile.userDataDir);
          await this.applyProxySettingsForProfile(profile.userDataDir, port);
        },
        ensureTrafficIngress: (port, apiPort, options) =>
          this.ensureTrafficIngress(
            SHARED_PROXY_RUNTIME_KEY,
            port,
            apiPort,
            options
          ),
        stopTrafficIngress: () => this.deps.trafficIngress.stopAll(),
        getRuntime: () => this.runtimes.get(SHARED_PROXY_RUNTIME_KEY),
        setRuntime: (runtime) =>
          this.runtimes.set(SHARED_PROXY_RUNTIME_KEY, runtime),
        deleteRuntime: () => this.runtimes.delete(SHARED_PROXY_RUNTIME_KEY),
        stopRuntime: () => this.forceStopChild(SHARED_PROXY_RUNTIME_KEY),
        appendStarted: (port) => this.outputPresenter?.appendStarted(port),
        showOutput: () => this.outputPresenter?.show(),
        shouldAutoShowOutput: () => this.getOutputConfig().autoShowOutputChannel,
        notifyStatusChange: () => this.notifyStatusChange(),
      });
    this.profileLifecycleCoordinator = new ProxyProfileLifecycleCoordinator({
      profileManager: this.profileManager,
      stateStore: this.stateStore,
      sharedStateStore: this.sharedProxyStateStore,
      trafficIngress: this.deps.trafficIngress,
      getRuntime: (profileId) => this.runtimes.get(profileId),
      isSharedProxyActive: () => this.isSharedProxyActive(),
      createApiClient: (apiPort, apiToken) =>
        this.createApiClient(apiPort, apiToken),
      resolveApiPort: (mitmPort, persistedApiPort) =>
        this.resolveApiPort(mitmPort, persistedApiPort),
      ensureAgentTracking: (profileId, userDataDir) =>
        this.ensureAgentTracking(profileId, userDataDir),
      applyProxySettings: (userDataDir, port) =>
        this.applyProxySettingsForProfile(userDataDir, port),
      ensureTrafficIngress: (profileId, port, apiPort, options) =>
        this.ensureTrafficIngress(profileId, port, apiPort, options),
      forceStopChild: (profileId) => this.forceStopChild(profileId),
      restoreProxySettings: this.profileSettingsManager
        ? (userDataDir) =>
            this.profileSettingsManager!.restoreProxySettings(userDataDir)
        : undefined,
      appendStopped: () => this.outputPresenter?.appendStopped(),
      notifyStatusChange: () => this.notifyStatusChange(),
    });
  }

  private initializeReadModelCoordinators(): void {
    this.statusCoordinator = new ProxyStatusCoordinator({
      profileManager: this.profileManager,
      stateStore: this.stateStore,
      logDirectory: this.logDir,
      getRuntime: (profileId) => this.runtimes.get(profileId),
      readSharedState: () => this.readSharedProxyState(),
      resolveApiPort: (mitmPort, persistedApiPort) =>
        this.resolveApiPort(mitmPort, persistedApiPort),
      getRuntimePid: (runtime) =>
        runtime.process instanceof NodeProxyProcess
          ? runtime.process.getChild()?.pid
          : null,
      isProcessAlive: (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      },
      isPortAvailable: (port) => isPortAvailable(port),
    });
    this.trafficTailerCoordinator = new ProxyTrafficTailerCoordinator({
      profileManager: this.profileManager,
      getRuntime: (profileId) => this.runtimes.get(profileId),
      runtimes: () => this.runtimes,
      readSharedState: () => this.readSharedProxyState(),
      getStatus: (profileId) => this.getStatus(profileId),
      isRunning: (profileId) => this.isRunning(profileId),
      resolveApiPort: (mitmPort, persistedApiPort) =>
        this.resolveApiPort(mitmPort, persistedApiPort),
      getApiToken: (profileId) => this.getApiToken(profileId),
      ensureTrafficIngress: (profileId, mitmPort, apiPort, options) =>
        this.ensureTrafficIngress(profileId, mitmPort, apiPort, options),
    });
    this.outputCoordinator = new ProxyManagerOutputCoordinator({
      logDir: this.logDir,
      getOutputConfig: this.getOutputConfig,
      getRuntimeCount: () => this.runtimes.size,
      outputPresenter: this.outputPresenter,
      tokenDetectorPresenter: this.tokenDetectorPresenter,
      ensureOutputTailer: (profileId, options) =>
        this.trafficTailerCoordinator.ensureOutputTailer(profileId, options),
      ensureTrafficTailer: () => this.trafficTailerCoordinator.ensureTrafficTailer(),
    });
  }

  private initializeStopCoordinator(): void {
    this.profileRoutingConfiguration = new ProxyProfileRoutingConfiguration({
      authReader: this.deps.authReader,
    });
    this.childProcessStopCoordinator = new ProxyChildProcessStopCoordinator({
      getRuntime: (profileId) => this.runtimes.get(profileId),
      deleteRuntime: (profileId) => this.runtimes.delete(profileId),
      deleteAgentTracking: (profileId) =>
        this.agentTrackingCoordinator.delete(profileId),
      stateStore: this.stateStore,
      getChildPid: (runtime) =>
        runtime.process instanceof NodeProxyProcess
          ? runtime.process.getChild()?.pid
          : undefined,
      detach: (runtime) => {
        if (runtime.process instanceof NodeProxyProcess) {
          runtime.process.detach();
        }
      },
      gracePeriodMs: 500,
      wait: (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)),
    });
  }

  private isSharedProxyActive(): boolean {
    return this.runtimes.has(SHARED_PROXY_RUNTIME_KEY);
  }

  private async readSharedProxyState(): Promise<ProxyStateFile | null> {
    return this.sharedProxyStateStore.read();
  }

  private async buildUserIdMapping(
    profiles: Profile[]
  ): Promise<Map<string, string>> {
    return this.profileRoutingConfiguration.buildUserIdMapping(profiles);
  }

  private buildProfileDbPaths(profiles: Profile[]): Record<string, string> {
    return this.profileRoutingConfiguration.buildProfileDbPaths(profiles);
  }

  async ensureSharedProxy(profiles: Profile[]): Promise<ProxyStartResult> {
    return this.sharedProxyLifecycleCoordinator.ensure(profiles);
  }

  async stopAll(): Promise<void> {
    await this.sharedProxyLifecycleCoordinator.stop();
  }

  /** Stop extension-host traffic ingress without stopping an externally owned proxy. */
  dispose(): void {
    this.deps.trafficIngress.stopAll();
  }

  private async handleTraffic(
    summary: Parameters<TrafficListener>[0],
    profileId?: string
  ): Promise<void> {
    const effectiveProfileId = await this.trafficUsageCoordinator.handle(
      summary,
      profileId
    );
    this.outputCoordinator.presentTraffic(summary, effectiveProfileId);
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

  private notifyUsagePersisted(event: ConversationUsagePersistedEvent): void {
    for (const listener of this.usagePersistedListeners) {
      try {
        listener(event);
      } catch (error) {
        extensionLog.debug(
          `[Proxy] usage persisted listener error: ${extensionLog.formatError(error)}`
        );
      }
    }
  }

  getAgentTrackingService(profileId: string): AgentTrackingService | undefined {
    return this.agentTrackingCoordinator.get(profileId);
  }

  private getApiPortOffset(): number {
    return vscode.workspace
      .getConfiguration('cursorAccounts.proxy')
      .get<number>('apiPortOffset', 10_000);
  }

  private resolveApiPort(mitmPort: number, persistedApiPort?: number): number {
    return resolveProxyApiPort(
      mitmPort,
      this.getApiPortOffset(),
      persistedApiPort
    );
  }

  private createApiClient(apiPort: number, apiToken?: string): ProxyApiClient {
    return new ProxyApiClient({
      baseUrl: buildProxyApiBaseUrl(apiPort),
      reconnect: false,
      apiToken,
    });
  }

  private async ensureTrafficIngress(
    profileId: string,
    mitmPort: number,
    apiPort: number,
    options?: {
      forceRestart?: boolean;
      tailFromStart?: boolean;
      apiToken?: string;
    }
  ): Promise<void> {
    await this.trafficIngressCoordinator.ensure(
      profileId,
      mitmPort,
      apiPort,
      options
    );
  }

  async connectToExistingProxy(profileId: string): Promise<void> {
    await this.profileLifecycleCoordinator.connectToExistingProxy(profileId);
  }

  async start(profileId: string): Promise<ProxyStartResult> {
    const profile = await this.profileManager.getProfile(profileId);
    if (!profile) {
      return { success: false, error: `Profile ${profileId} not found` };
    }

    if (isProfileProxyEnabled(profile)) {
      const profiles = await this.profileManager.getProfiles();
      return this.ensureSharedProxy(profiles);
    }

    return { success: false, error: 'Proxy is disabled for this profile' };
  }

  async stop(
    profileId: string,
    options?: { restoreSettings?: boolean }
  ): Promise<void> {
    await this.profileLifecycleCoordinator.stop(profileId, options);
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
    return this.statusCoordinator.getStatus(profileId);
  }

  async isRunning(profileId: string): Promise<boolean> {
    const status = await this.getStatus(profileId);
    return status?.running === true;
  }

  async isCurrentWindowUsingProxy(): Promise<boolean> {
    await Promise.resolve();
    const hasProxyArg = process.argv.some((arg) =>
      arg.includes('--proxy-server')
    );
    const hasCaCert =
      process.env.NODE_EXTRA_CA_CERTS != null &&
      process.env.NODE_EXTRA_CA_CERTS.length > 0;
    return hasProxyArg || hasCaCert;
  }

  private async getApiToken(profileId: string): Promise<string | undefined> {
    const runtime = this.runtimes.get(profileId);
    if (runtime?.apiToken) {
      return runtime.apiToken;
    }
    const sharedRuntime = this.runtimes.get(SHARED_PROXY_RUNTIME_KEY);
    if (sharedRuntime?.apiToken) {
      return sharedRuntime.apiToken;
    }
    const sharedState = await this.readSharedProxyState();
    if (sharedState?.apiToken) {
      return sharedState.apiToken;
    }
    const profile = await this.profileManager.getProfile(profileId);
    if (!profile) {
      return undefined;
    }
    return (await this.stateStore.read(profile.userDataDir))?.apiToken;
  }

  async getCertificatePath(): Promise<string | null> {
    return this.deps.certService.getCertificatePath();
  }

  getLogDirectory(): string {
    return this.outputCoordinator.getLogDirectory();
  }

  async clearLogFiles(): Promise<{
    deletedFiles: number;
    deletedBytes: number;
  }> {
    return this.outputCoordinator.clearLogFiles();
  }

  showTokenDetectorChannel(): void {
    this.outputCoordinator.showTokenDetectorChannel();
  }

  async ensureOutputTailer(
    profileId: string,
    options?: ProxyTrafficTailerOptions
  ): Promise<void> {
    await this.outputCoordinator.ensureOutputTailer(profileId, options);
  }

  async ensureTrafficTailer(): Promise<void> {
    await this.outputCoordinator.ensureTrafficTailer();
  }

  showOutputChannel(): void {
    this.outputCoordinator.showOutputChannel();
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
    const profile = await this.profileManager.getProfile(profileId);
    if (!profile || !isProfileProxyEnabled(profile)) {
      return { success: false, error: 'Proxy is disabled for this profile' };
    }
    const profiles = await this.profileManager.getProfiles();
    return this.ensureSharedProxy(profiles);
  }

  private buildServerConfig(
    port: number,
    profile: Profile,
    overrides?: Partial<ProxyServerConfig>
  ): ProxyServerConfig {
    return this.serverConfigurationBuilder.build(port, profile, overrides);
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
    await this.agentTrackingCoordinator.ensureForProfile(
      profileId,
      this.profileManager
    );
  }

  private async ensureAgentTracking(
    profileId: string,
    userDataDir: string
  ): Promise<void> {
    await this.agentTrackingCoordinator.ensure(profileId, userDataDir);
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
    await this.childProcessStopCoordinator.stop(profileId);
  }
}

export { PROXY_STATE_FILE_NAME };
