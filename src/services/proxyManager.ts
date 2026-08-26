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
  type ProxyStatus,
  type ProxyTrafficDiagnostics,
  type Profile,
} from '@cursor-accounts/types';
import { formatDiagnosticsSummaryLines } from '../proxy/proxyTrafficDiagnostics';
import * as extensionLog from '../logging/extensionLog';
import { getSharedProxyStorageDir } from '../proxy/sharedProxyPaths';
import {
  getAllUsedProxyPorts,
} from '../proxy/resolvePortForProfile';
import { PROXY_STATE_FILE_NAME } from '../proxy/types';
import type { AgentTrackingService } from './agentTrackingService';
import {
  createDefaultProxyManagerDependencies,
  type ProxyManagerDependencies,
} from './proxyManagerDefaultDependencies';
import {
  type ProxyTrafficTailerOptions,
} from './proxyTrafficTailerCoordinator';
import type { ProxySettingsService } from './proxySettingsService';

export type { ConversationUsagePersistedEvent, ConversationUsagePersistedListener, ProxyTrafficListener } from '../domain/ports/IProxyTraffic';

export type { ProxyManagerDependencies } from './proxyManagerDefaultDependencies';
import {
  createProxyManagerComposition,
  type ProxyManagerComposition,
  type ProxyManagerRuntime,
} from './proxyManagerComposition';

/**
 * Facade for per-profile MITM proxy lifecycle, certificates, and traffic distribution.
 */
export class ProxyManager implements IProxyManager {
  private readonly runtimes = new Map<string, ProxyManagerRuntime>();
  private readonly statusCallbacks: Array<() => void> = [];
  private readonly usagePersistedListeners: ConversationUsagePersistedListener[] =
    [];
  private lastDiagnosticsOutputAt = 0;
  private disposed = false;
  private readonly deps: ProxyManagerDependencies;
  private readonly composition: ProxyManagerComposition;
  private readonly unsubscribeTraffic: () => void;

  constructor(
    private readonly stateStore: IProxyStateStore,
    private readonly profileManager: IProfileReader,
    context: vscode.ExtensionContext,
    storageDir: string = getSharedProxyStorageDir(),
    private readonly proxySettingsService?: ProxySettingsService,
    profileSettingsManager?: IProfileSettingsManager,
    private readonly outputPresenter?: IProxyOutputPresenter,
    tokenDetectorPresenter?: ITokenDetectorOutputPresenter,
    deps?: ProxyManagerDependencies,
    getOutputConfig?: () => ProxyOutputSettings,
    compositionFactory: typeof createProxyManagerComposition =
      createProxyManagerComposition
  ) {
    const logDir = path.join(storageDir, 'logs');
    this.deps =
      deps ??
      createDefaultProxyManagerDependencies({
        storageDir,
        logDir,
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
    const outputConfig =
      getOutputConfig ??
      (() => {
        const config = vscode.workspace.getConfiguration('cursorAccounts.proxy');
        return {
          logTrafficToOutput: config.get<boolean>('logTrafficToOutput', true),
          autoShowOutputChannel: config.get<boolean>('autoShowOutputChannel', false),
          outputCursorHostsOnly: config.get<boolean>('outputCursorHostsOnly', false),
        };
      });
    this.composition = compositionFactory({
      stateStore,
      profileManager,
      context,
      storageDir,
      profileSettingsManager,
      outputPresenter,
      tokenDetectorPresenter,
      dependencies: this.deps,
      getOutputConfig: outputConfig,
      callbacks: {
        notifyStatusChange: () => this.notifyStatusChange(),
        notifyUsagePersisted: (event) => this.notifyUsagePersisted(event),
      },
      runtimes: this.runtimes,
    });
    this.unsubscribeTraffic = this.deps.trafficBus.subscribe((summary, profileId) => {
      void this.handleTraffic(summary, profileId);
    });
  }

  async ensureSharedProxy(profiles: Profile[]): Promise<ProxyStartResult> {
    return this.composition.sharedProxyLifecycleCoordinator.ensure(profiles);
  }

  async stopAll(): Promise<void> {
    await this.composition.sharedProxyLifecycleCoordinator.stop();
  }

  /** Stop extension-host traffic ingress without stopping an externally owned proxy. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unsubscribeTraffic();
    this.deps.trafficIngress.stopAll();
  }

  private async handleTraffic(
    summary: Parameters<TrafficListener>[0],
    profileId?: string
  ): Promise<void> {
    const effectiveProfileId = await this.composition.trafficUsageCoordinator.handle(
      summary,
      profileId
    );
    this.composition.outputCoordinator.presentTraffic(
      summary,
      effectiveProfileId
    );
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
    return this.composition.getAgentTrackingService(profileId);
  }

  async connectToExistingProxy(profileId: string): Promise<void> {
    await this.composition.profileLifecycleCoordinator.connectToExistingProxy(
      profileId
    );
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
    await this.composition.profileLifecycleCoordinator.stop(profileId, options);
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
    return this.composition.statusCoordinator.getStatus(profileId);
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

  async getCertificatePath(): Promise<string | null> {
    return this.deps.certService.getCertificatePath();
  }

  getLogDirectory(): string {
    return this.composition.outputCoordinator.getLogDirectory();
  }

  async clearLogFiles(): Promise<{
    deletedFiles: number;
    deletedBytes: number;
  }> {
    return this.composition.outputCoordinator.clearLogFiles();
  }

  showTokenDetectorChannel(): void {
    this.composition.outputCoordinator.showTokenDetectorChannel();
  }

  async ensureOutputTailer(
    profileId: string,
    options?: ProxyTrafficTailerOptions
  ): Promise<void> {
    await this.composition.outputCoordinator.ensureOutputTailer(
      profileId,
      options
    );
  }

  async ensureTrafficTailer(): Promise<void> {
    await this.composition.outputCoordinator.ensureTrafficTailer();
  }

  showOutputChannel(): void {
    this.composition.outputCoordinator.showOutputChannel();
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

}

export { PROXY_STATE_FILE_NAME };
