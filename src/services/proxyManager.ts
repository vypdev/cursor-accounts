import * as path from 'path';
import * as vscode from 'vscode';
import type {
  ProxyStartResult,
  IProxyManager,
  RestoreAllProfilesResult,
} from '../domain/ports/IProxyManager';
import type {
  ConversationUsagePersistedListener,
  ProxyTrafficListener,
} from '../domain/ports/IProxyTraffic';
import type { TrafficListener } from '../domain/ports/IProxyTrafficBus';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import type {
  IProxyOutputPresenter,
  ITokenDetectorOutputPresenter,
  ProxyOutputSettings,
} from '../domain/ports/IProxyOutputPresenter';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import {
  type ProxyInstallGuide,
  type ProxyStatus,
  type Profile,
} from '@cursor-accounts/types';
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
import type { IProxySettingsRestorer } from '../domain/ports/IProxySettingsRestorer';
import type { ProxySettingsApplicationService } from '../application/services/proxySettingsApplicationService';
import {
  ProxyManagerDiagnosticsCoordinator,
} from './proxyManagerDiagnosticsCoordinator';
import {
  ProxyManagerEventRegistry,
} from './proxyManagerEventRegistry';
import { ProxyProfileLifecycleUseCase } from '../application/services/proxyProfileLifecycleUseCase';

export type { ConversationUsagePersistedEvent, ConversationUsagePersistedListener, ProxyTrafficListener } from '../domain/ports/IProxyTraffic';

export type { ProxyManagerDependencies } from './proxyManagerDefaultDependencies';
import {
  createProxyManagerComposition,
  type ProxyManagerComposition,
  type ProxyManagerRuntime,
} from './proxyManagerComposition';

export interface ProxyManagerOptions {
  stateStore: IProxyStateStore;
  profileManager: IProfileReader;
  context: vscode.ExtensionContext;
  storageDir?: string;
  proxySettingsRestorer?: IProxySettingsRestorer;
  profileSettingsManager?: IProfileSettingsManager;
  outputPresenter?: IProxyOutputPresenter;
  tokenDetectorPresenter?: ITokenDetectorOutputPresenter;
  dependencies?: ProxyManagerDependencies;
  getOutputConfig?: () => ProxyOutputSettings;
  compositionFactory?: typeof createProxyManagerComposition;
  proxySettingsApplicationService?: Pick<
    ProxySettingsApplicationService,
    'applyProxySettings'
  >;
}

/**
 * Facade for per-profile MITM proxy lifecycle, certificates, and traffic distribution.
 */
export class ProxyManager implements IProxyManager {
  private readonly runtimes = new Map<string, ProxyManagerRuntime>();
  private readonly stateStore: IProxyStateStore;
  private readonly profileManager: IProfileReader;
  private readonly proxySettingsRestorer?: IProxySettingsRestorer;
  private readonly deps: ProxyManagerDependencies;
  private readonly composition: ProxyManagerComposition;
  private readonly events: ProxyManagerEventRegistry;
  private readonly profileLifecycleUseCase: ProxyProfileLifecycleUseCase;

  constructor(options: ProxyManagerOptions) {
    const {
      stateStore,
      profileManager,
      context,
      proxySettingsRestorer,
      profileSettingsManager,
      outputPresenter,
      tokenDetectorPresenter,
      dependencies,
      getOutputConfig,
      compositionFactory = createProxyManagerComposition,
      proxySettingsApplicationService,
    } = options;
    const storageDir = options.storageDir ?? getSharedProxyStorageDir();
    this.stateStore = stateStore;
    this.profileManager = profileManager;
    this.proxySettingsRestorer = proxySettingsRestorer;
    const logDir = path.join(storageDir, 'logs');
    const diagnosticsCoordinator = new ProxyManagerDiagnosticsCoordinator({
      getSettings: () => {
        const config = vscode.workspace.getConfiguration('cursorAccounts.proxy');
        return {
          enabled: config.get<boolean>('trafficDiagnostics', true),
          intervalMs: config.get<number>('diagnosticsIntervalMs', 30_000),
        };
      },
      outputPresenter,
    });
    this.deps =
      dependencies ??
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
          diagnosticsCoordinator.maybeEmit(diagnostics),
      });
    this.events = new ProxyManagerEventRegistry({
      subscribeTraffic: (listener) => this.deps.trafficBus.subscribe(listener),
      stopTrafficIngress: () => this.deps.trafficIngress.stopAll(),
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
      proxySettingsApplicationService,
      outputPresenter,
      tokenDetectorPresenter,
      dependencies: this.deps,
      getOutputConfig: outputConfig,
      callbacks: {
        notifyStatusChange: () => this.events.notifyStatusChange(),
        notifyUsagePersisted: (event) =>
          this.events.notifyUsagePersisted(event),
      },
      runtimes: this.runtimes,
    });
    this.events.setTrafficHandler((summary, profileId) =>
      this.handleTraffic(summary, profileId)
    );
    this.profileLifecycleUseCase = new ProxyProfileLifecycleUseCase({
      profileReader: this.profileManager,
      ensureSharedProxy: (profiles) => this.ensureSharedProxy(profiles),
      isRunning: (profileId) => this.isRunning(profileId),
      stop: (profileId, options) =>
        this.composition.profileLifecycleCoordinator.stop(profileId, options),
      logInfo: (message) => extensionLog.info(message),
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
    this.events.dispose();
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
    this.events.onStatusChange(callback);
  }

  onTraffic(listener: ProxyTrafficListener): void {
    this.events.onTraffic(listener);
  }

  onConversationUsagePersisted(
    listener: ConversationUsagePersistedListener
  ): void {
    this.events.onConversationUsagePersisted(listener);
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
    return this.profileLifecycleUseCase.start(profileId);
  }

  async stop(
    profileId: string,
    options?: { restoreSettings?: boolean }
  ): Promise<void> {
    await this.composition.profileLifecycleCoordinator.stop(profileId, options);
  }

  async restartProfileProxy(profileId: string): Promise<ProxyStartResult> {
    return this.profileLifecycleUseCase.restart(profileId);
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
    if (!this.proxySettingsRestorer) {
      return { restored: 0, errors: [] };
    }
    return await this.proxySettingsRestorer.restoreAllProfiles();
  }

  async ensureProfileProxy(profileId: string): Promise<ProxyStartResult> {
    return this.profileLifecycleUseCase.ensureProfileProxy(profileId);
  }

}

export { PROXY_STATE_FILE_NAME };
