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
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import {
  isProfileProxyEnabled,
  isProfileProxyJsonlLoggingEnabled,
  type ProxyInstallGuide,
  type ProxyStateFile,
  type ProxyStatus,
  type ProxyTrafficDiagnostics,
  type Profile,
} from '@cursor-accounts/types';
import type { ProxyServerConfig } from '../application/types/proxyConfig';
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
import {
  buildProxyApiBaseUrl,
  ProxyApiClient,
  resolveProxyApiPort,
} from '../proxy/api/proxyApiClient';
import {
  PROXY_API_PATHS,
  type ProxyApiHealthResponse,
} from '../application/types/proxyApi';
import { isPortAvailable, isProcessAlive } from '../proxy/portUtils';
import {
  getAllUsedProxyPorts,
} from '../proxy/resolvePortForProfile';
import {
  PROXY_STATE_SCHEMA_VERSION,
  PROXY_STATE_FILE_NAME,
  DEFAULT_PROXY_PORT,
  SHARED_PROXY_RUNTIME_KEY,
  SHARED_PROXY_STATE_FILE_NAME,
} from '../proxy/types';
import { decodeJwtPayload } from '../auth/tokenReader';
import { ProfileAuthReader } from '../auth/profileAuthReader';
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
const PROXY_HEALTH_POLL_MS = 200;
const PROXY_STOP_GRACE_MS = 500;

interface ProfileProxyRuntime {
  process: IProxyProcess;
  port: number;
  apiPort: number;
  userDataDir: string;
}

export interface ProxyManagerDependencies {
  certService: IProxyCertificateService;
  trafficBus: IProxyTrafficBus;
  trafficIngress: IProxyTrafficIngress;
  createProcess: () => IProxyProcess;
  authReader?: IProfileAuthReader;
}

/**
 * Facade for per-profile MITM proxy lifecycle, certificates, and traffic distribution.
 */
export class ProxyManager implements IProxyManager {
  private readonly runtimes = new Map<string, ProfileProxyRuntime>();
  private readonly statusCallbacks: Array<() => void> = [];
  private readonly usagePersistedListeners: ConversationUsagePersistedListener[] =
    [];
  private readonly agentTrackingServices = new Map<string, AgentTrackingService>();
  private readonly storageDir: string;
  private readonly logDir: string;
  private lastDiagnosticsOutputAt = 0;
  private readonly deps: ProxyManagerDependencies;

  constructor(
    private readonly stateStore: IProxyStateStore,
    private readonly profileManager: IProfileManager,
    private readonly context: vscode.ExtensionContext,
    storageDir: string = getSharedProxyStorageDir(),
    private readonly proxySettingsService?: ProxySettingsService,
    private readonly profileSettingsManager?: IProfileSettingsManager,
    private readonly outputPresenter?: ProxyOutputPresenter,
    private readonly tokenDetectorPresenter?: TokenDetectorOutputPresenter,
    deps?: ProxyManagerDependencies
  ) {
    this.storageDir = storageDir;
    this.logDir = path.join(this.storageDir, 'logs');
    this.deps =
      deps ??
      this.createDefaultDependencies(
        storageDir,
        this.logDir,
        context.extensionPath
      );
    this.deps.trafficBus.subscribe((summary, profileId) => {
      void this.handleTraffic(summary, profileId);
    });
  }

  private createDefaultDependencies(
    storageDir: string,
    logDir: string,
    extensionPath: string
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
            this.outputPresenter?.appendTailing(filePath);
          }
        },
        onTailerError: (profileId, summary) => {
          extensionLog.warn(
            `[Proxy:${profileId}] ${summary.errorKind ?? 'PROXY_ERROR'}: ${summary.errorMessage ?? 'unknown error'}`
          );
        },
        onStats: (_profileId, stats) => {
          this.maybeEmitDiagnosticsSummary(stats.diagnostics);
        },
        onDiagnostics: (_profileId, lines) => {
          this.outputPresenter?.appendDiagnostics(lines);
        },
      }
    );

    const scriptPath = path.join(extensionPath, 'out', 'proxy', 'proxyServer.js');

    return {
      certService: new ProxyCertificateService(
        certManager,
        this.stateStore,
        this.profileManager
      ),
      trafficBus,
      trafficIngress,
      createProcess: () => new NodeProxyProcess(scriptPath, extensionPath),
      authReader: new ProfileAuthReader(this.context),
    };
  }

  private isSharedProxyActive(): boolean {
    return this.runtimes.has(SHARED_PROXY_RUNTIME_KEY);
  }

  private getSharedStatePath(): string {
    return path.join(this.storageDir, SHARED_PROXY_STATE_FILE_NAME);
  }

  private async readSharedProxyState(): Promise<ProxyStateFile | null> {
    try {
      const content = await fs.readFile(this.getSharedStatePath(), 'utf-8');
      return JSON.parse(content) as ProxyStateFile;
    } catch {
      return null;
    }
  }

  private async writeSharedProxyState(state: ProxyStateFile): Promise<void> {
    const statePath = this.getSharedStatePath();
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }

  private async clearSharedProxyState(): Promise<void> {
    try {
      await fs.unlink(this.getSharedStatePath());
    } catch {
      // ignore missing file
    }
  }

  private async buildUserIdMapping(
    profiles: Profile[]
  ): Promise<Map<string, string>> {
    const mapping = new Map<string, string>();
    const authReader = this.deps.authReader;
    if (!authReader) {
      return mapping;
    }

    for (const profile of profiles) {
      if (!isProfileProxyEnabled(profile)) {
        continue;
      }
      try {
        const tokens = await authReader.readTokens(profile.userDataDir);
        if (!tokens?.accessToken) {
          continue;
        }
        const payload = decodeJwtPayload(tokens.accessToken);
        const sub = payload?.sub;
        if (typeof sub !== 'string' || !sub) {
          continue;
        }
        const userId = sub.includes('|') ? sub.split('|').pop()! : sub;
        mapping.set(userId, profile.id);
        extensionLog.info(
          `[Proxy] Mapped user ${userId.slice(0, 8)}… → profile ${profile.displayName}`
        );
      } catch (error) {
        extensionLog.warn(
          `[Proxy] Failed to map user for profile ${profile.displayName}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return mapping;
  }

  private buildProfileDbPaths(profiles: Profile[]): Record<string, string> {
    const profileDbPaths: Record<string, string> = {};
    for (const profile of profiles) {
      if (isProfileProxyEnabled(profile)) {
        profileDbPaths[profile.id] = getEfficiencyDbPath(profile.userDataDir);
      }
    }
    return profileDbPaths;
  }

  async ensureSharedProxy(profiles: Profile[]): Promise<ProxyStartResult> {
    const enabledProfiles = profiles.filter(isProfileProxyEnabled);
    if (enabledProfiles.length === 0) {
      return { success: false, error: 'No profiles with proxy enabled' };
    }

    const existing = this.runtimes.get(SHARED_PROXY_RUNTIME_KEY);
    if (existing) {
      for (const profile of enabledProfiles) {
        await this.applyProxySettingsForProfile(
          profile.userDataDir,
          existing.port
        );
        await this.ensureAgentTracking(profile.id, profile.userDataDir);
        await this.ensureTrafficIngress(
          SHARED_PROXY_RUNTIME_KEY,
          existing.port,
          existing.apiPort,
          { forceRestart: false }
        );
      }
      return { success: true, port: existing.port };
    }

    const sharedState = await this.readSharedProxyState();
    if (sharedState?.running && sharedState.port != null) {
      const apiPort = this.resolveApiPort(sharedState.port, sharedState.apiPort);
      try {
        const probe = new ProxyApiClient({
          baseUrl: buildProxyApiBaseUrl(apiPort),
          reconnect: false,
        });
        const status = await probe.getStatus();
        if (status.running) {
          for (const profile of enabledProfiles) {
            await this.applyProxySettingsForProfile(
              profile.userDataDir,
              sharedState.port!
            );
            await this.ensureAgentTracking(profile.id, profile.userDataDir);
          }
          await this.ensureTrafficIngress(
            SHARED_PROXY_RUNTIME_KEY,
            sharedState.port,
            apiPort,
            { forceRestart: true }
          );
          this.notifyStatusChange();
          return { success: true, port: sharedState.port };
        }
      } catch {
        await this.clearSharedProxyState();
      }
    }

    const port = DEFAULT_PROXY_PORT;
    if (!(await isPortAvailable(port))) {
      return {
        success: false,
        error: `Shared proxy port ${port} is not available`,
      };
    }

    await fs.mkdir(this.storageDir, { recursive: true });
    await fs.mkdir(this.logDir, { recursive: true });

    const caPath = await this.deps.certService.ensureCaCertificate();
    const anchorProfile = enabledProfiles[0]!;
    const userIdToProfileId = await this.buildUserIdMapping(enabledProfiles);
    const profileDbPaths = this.buildProfileDbPaths(enabledProfiles);
    const serverConfig = this.buildServerConfig(port, anchorProfile, {
      profileId: SHARED_PROXY_RUNTIME_KEY,
      userIdToProfileId: Object.fromEntries(userIdToProfileId),
      profileDbPaths,
      extensionPath: this.context.extensionPath,
    });

    const proxyProcess = this.deps.createProcess();
    const stderrLines: string[] = [];
    proxyProcess.onStderr((line) => {
      stderrLines.push(line);
      if (line.includes('[AgentTracking]') || line.includes('[DbPool]')) {
        extensionLog.info(`[Proxy:shared] ${line}`);
      } else {
        extensionLog.debug(`[Proxy:shared] ${line}`);
      }
    });

    proxyProcess.onExit((code) => {
      extensionLog.warn(
        `[Proxy:shared] Child process exited with code ${code ?? 'unknown'}`
      );
      this.runtimes.delete(SHARED_PROXY_RUNTIME_KEY);
      void this.clearSharedProxyState();
      this.deps.trafficIngress.stopAll();
      this.notifyStatusChange();
    });

    const runtime = await proxyProcess.start(serverConfig);
    const ready = await this.pollProxyHealth(
      serverConfig.apiPort,
      PROXY_START_TIMEOUT_MS,
      {
        getStderr: () => stderrLines.join('\n'),
        isProcessAlive: () =>
          runtime.pid != null && proxyProcess.isAlive(runtime.pid),
      }
    );
    if (!ready.success) {
      await proxyProcess.stop(runtime.pid, 'SIGKILL');
      if (proxyProcess instanceof NodeProxyProcess) {
        proxyProcess.detach();
      }
      return { success: false, error: ready.error };
    }

    this.runtimes.set(SHARED_PROXY_RUNTIME_KEY, {
      process: proxyProcess,
      port,
      apiPort: serverConfig.apiPort,
      userDataDir: this.storageDir,
    });

    const state: ProxyStateFile = {
      version: PROXY_STATE_SCHEMA_VERSION,
      profileId: SHARED_PROXY_RUNTIME_KEY,
      running: true,
      port,
      apiPort: serverConfig.apiPort,
      pid: runtime.pid,
      startedAt: new Date().toISOString(),
      caCertificatePath: caPath,
      lastUpdatedAt: new Date().toISOString(),
    };
    await this.writeSharedProxyState(state);

    extensionLog.info(
      `[Proxy:shared] Started MITM on 127.0.0.1:${port}, API on 127.0.0.1:${serverConfig.apiPort} (pid ${runtime.pid})`
    );
    this.outputPresenter?.appendStarted(port);

    for (const profile of enabledProfiles) {
      await this.ensureAgentTracking(profile.id, profile.userDataDir);
      await this.applyProxySettingsForProfile(profile.userDataDir, port);
    }

    await this.ensureTrafficIngress(
      SHARED_PROXY_RUNTIME_KEY,
      port,
      serverConfig.apiPort,
      { forceRestart: true }
    );

    if (getProxyOutputConfig().autoShowOutputChannel) {
      this.outputPresenter?.show();
    }

    this.notifyStatusChange();
    return { success: true, port };
  }

  async stopAll(): Promise<void> {
    if (!this.isSharedProxyActive()) {
      return;
    }

    const runtime = this.runtimes.get(SHARED_PROXY_RUNTIME_KEY);
    const apiPort = runtime?.apiPort;

    if (apiPort != null) {
      try {
        await new ProxyApiClient({
          baseUrl: buildProxyApiBaseUrl(apiPort),
          reconnect: false,
        }).shutdown();
        await new Promise((resolve) => setTimeout(resolve, PROXY_STOP_GRACE_MS));
      } catch (error) {
        extensionLog.debug(
          `[Proxy:shared] API shutdown failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    await this.forceStopChild(SHARED_PROXY_RUNTIME_KEY);
    this.deps.trafficIngress.stopAll();
    await this.clearSharedProxyState();
    this.notifyStatusChange();
  }

  /** Stop extension-host traffic ingress without stopping an externally owned proxy. */
  dispose(): void {
    this.deps.trafficIngress.stopAll();
  }

  private async handleTraffic(
    summary: Parameters<TrafficListener>[0],
    profileId?: string
  ): Promise<void> {
    const effectiveProfileId = summary.profileId ?? profileId;
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
        `[AgentTracking] proxy recv profile=${effectiveProfileId ?? '(none)'} ` +
          `live=${summary.isLiveTokenUpdate === true} turnEnded=${summary.isTurnEnded === true} ` +
          `bidi=${bidi ? `${bidi.slice(0, 8)}…` : '(none)'} ` +
          `conv=${conv ? `${conv.slice(0, 8)}…` : '(none)'} ` +
          `usage=${agent?.usageEvent ?? '(none)'} ` +
          `delta=${summary.liveTokenData?.latestDelta ?? '(none)'} ` +
          `endpoint=${summary.endpoint ?? summary.url}`
      );
    }

    if (effectiveProfileId && effectiveProfileId !== SHARED_PROXY_RUNTIME_KEY) {
      if (!this.isSharedProxyActive()) {
        await this.ensureAgentTrackingForProfile(effectiveProfileId);
        const tracking = this.agentTrackingServices.get(effectiveProfileId);
        if (!tracking && isAgentTraffic) {
          extensionLog.warn(
            `[AgentTracking] no AgentTrackingService for profile=${effectiveProfileId}`
          );
        }
        const result = await tracking?.ingestTraffic(summary);
        if (isAgentTraffic) {
          extensionLog.info(
            `[AgentTracking] ingest result profile=${effectiveProfileId} ` +
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
                profileId: effectiveProfileId,
              });
            } catch (error) {
              extensionLog.debug(
                `[Proxy] usage persisted listener error: ${extensionLog.formatError(error)}`
              );
            }
          }
        }
      } else if (isAgentTraffic) {
        const conversationId =
          agent?.conversationId ?? summary.insights?.context?.conversationId;
        if (
          conversationId &&
          (summary.isLiveTokenUpdate ||
            summary.isTurnEnded ||
            agent?.usageEvent === 'token_details')
        ) {
          for (const listener of this.usagePersistedListeners) {
            try {
              listener({
                conversationId,
                profileId: effectiveProfileId,
              });
            } catch (error) {
              extensionLog.debug(
                `[Proxy] usage persisted listener error: ${extensionLog.formatError(error)}`
              );
            }
          }
        }
      }
    } else if (isAgentTraffic) {
      extensionLog.warn(
        '[AgentTracking] agent traffic without profileId — ingest skipped'
      );
    }
    this.tokenDetectorPresenter?.appendTraffic(summary, effectiveProfileId);
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

  private async ensureTrafficIngress(
    profileId: string,
    mitmPort: number,
    apiPort: number,
    options?: {
      forceRestart?: boolean;
      tailFromStart?: boolean;
    }
  ): Promise<void> {
    let jsonlTail = false;
    if (profileId === SHARED_PROXY_RUNTIME_KEY) {
      const profiles = await this.profileManager.getProfiles();
      jsonlTail = profiles.some((profile) => this.isProfileJsonlLogging(profile));
    } else {
      const profile = await this.profileManager.getProfile(profileId);
      jsonlTail = profile ? this.isProfileJsonlLogging(profile) : false;
    }

    const attached =
      !this.runtimes.has(profileId) || options?.forceRestart === true;
    if (attached && getProxyOutputConfig().logTrafficToOutput) {
      this.outputPresenter?.appendAttached(mitmPort);
    }

    await this.deps.trafficIngress.start(
      profileId,
      mitmPort,
      { api: true, jsonlTail },
      {
        apiPort,
        attached,
        tailFromStart: options?.tailFromStart,
        forceRestart: options?.forceRestart,
      }
    );
  }

  async connectToExistingProxy(profileId: string): Promise<void> {
    const profile = await this.profileManager.getProfile(profileId);
    if (!profile || !isProfileProxyEnabled(profile)) {
      return;
    }

    const sharedState = await this.readSharedProxyState();
    if (sharedState?.running && sharedState.port != null) {
      const apiPort = this.resolveApiPort(sharedState.port, sharedState.apiPort);
      try {
        const probe = new ProxyApiClient({
          baseUrl: buildProxyApiBaseUrl(apiPort),
          reconnect: false,
        });
        const status = await probe.getStatus();
        if (status.running) {
          await this.ensureAgentTracking(profileId, profile.userDataDir).catch(
            (error) => {
              extensionLog.warn(
                `[Proxy:${profileId}] Agent tracking init failed during attach: ${
                  error instanceof Error ? error.message : String(error)
                }`
              );
            }
          );
          await this.applyProxySettingsForProfile(
            profile.userDataDir,
            sharedState.port
          );
          await this.ensureTrafficIngress(
            SHARED_PROXY_RUNTIME_KEY,
            sharedState.port,
            apiPort,
            { forceRestart: true }
          );
          this.notifyStatusChange();
          return;
        }
      } catch {
        await this.clearSharedProxyState();
      }
    }

    const state = await this.stateStore.read(profile.userDataDir);
    if (!state?.running || state.port == null) {
      return;
    }

    const apiPort = this.resolveApiPort(state.port, state.apiPort);

    try {
      const probe = new ProxyApiClient({
        baseUrl: buildProxyApiBaseUrl(apiPort),
        reconnect: false,
      });
      const status = await probe.getStatus();
      if (!status.running) {
        await this.stateStore.clear(profile.userDataDir);
        return;
      }

      await this.ensureAgentTracking(profileId, profile.userDataDir).catch(
        (error) => {
          extensionLog.warn(
            `[Proxy:${profileId}] Agent tracking init failed during attach: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      );
      await this.applyProxySettingsForProfile(profile.userDataDir, state.port);
      await this.ensureTrafficIngress(profileId, state.port, apiPort, {
        forceRestart: true,
      });
      this.notifyStatusChange();
    } catch (error) {
      extensionLog.warn(
        `[Proxy:${profileId}] Failed to attach to existing proxy API: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      await this.stateStore.clear(profile.userDataDir);
      this.notifyStatusChange();
    }
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
    const restoreSettings = options?.restoreSettings !== false;
    try {
      const profile = await this.profileManager.getProfile(profileId);
      if (!profile) {
        return;
      }

      if (this.isSharedProxyActive()) {
        if (restoreSettings && this.profileSettingsManager) {
          try {
            await this.profileSettingsManager.restoreProxySettings(
              profile.userDataDir
            );
          } catch (error) {
            extensionLog.warn(
              `[Proxy:${profileId}] Failed to restore profile settings: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }
        return;
      }

      const runtime = this.runtimes.get(profileId);
      const state = await this.stateStore.read(profile.userDataDir);
      const apiPort =
        runtime?.apiPort ??
        (state?.port != null
          ? this.resolveApiPort(state.port, state.apiPort)
          : undefined);

      if (apiPort != null) {
        try {
          await new ProxyApiClient({
            baseUrl: buildProxyApiBaseUrl(apiPort),
            reconnect: false,
          }).shutdown();
          await new Promise((resolve) => setTimeout(resolve, PROXY_STOP_GRACE_MS));
        } catch (error) {
          extensionLog.debug(
            `[Proxy:${profileId}] API shutdown failed, falling back to process stop: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
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

    if (isProfileProxyEnabled(profile)) {
      const sharedRuntime = this.runtimes.get(SHARED_PROXY_RUNTIME_KEY);
      const sharedState = await this.readSharedProxyState();
      const port = sharedRuntime?.port ?? sharedState?.port;
      const apiPort =
        sharedRuntime?.apiPort ??
        (port != null ? this.resolveApiPort(port, sharedState?.apiPort) : undefined);
      const pid =
        sharedRuntime?.process instanceof NodeProxyProcess
          ? sharedRuntime.process.getChild()?.pid
          : sharedState?.pid;

      if (port != null && (sharedRuntime || sharedState?.running)) {
        const alive = pid != null && isProcessAlive(pid);
        if (alive) {
          return {
            running: true,
            port,
            apiPort,
            pid,
            startedAt: sharedState?.startedAt
              ? new Date(sharedState.startedAt).getTime()
              : undefined,
            caCertificatePath: sharedState?.caCertificatePath,
            logDirectory: this.logDir,
          };
        }
      }
    }

    const state = await this.stateStore.read(profile.userDataDir);
    const runtime = this.runtimes.get(profileId);

    if (!state) {
      if (runtime) {
        return {
          running: true,
          port: runtime.port,
          apiPort: runtime.apiPort,
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
      apiPort: state.apiPort ?? (port != null ? this.resolveApiPort(port) : undefined),
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

    const apiPort = this.resolveApiPort(status.port, status.apiPort);
    await this.ensureTrafficIngress(profileId, status.port, apiPort, {
      forceRestart: options?.forceRestart,
      tailFromStart: options?.tailFromStart,
    });
  }

  async ensureTrafficTailer(): Promise<void> {
    const sharedRuntime = this.runtimes.get(SHARED_PROXY_RUNTIME_KEY);
    if (sharedRuntime) {
      await this.ensureTrafficIngress(
        SHARED_PROXY_RUNTIME_KEY,
        sharedRuntime.port,
        sharedRuntime.apiPort,
        { forceRestart: false }
      );
      return;
    }

    const sharedState = await this.readSharedProxyState();
    if (sharedState?.running && sharedState.port != null) {
      const apiPort = this.resolveApiPort(sharedState.port, sharedState.apiPort);
      await this.ensureTrafficIngress(
        SHARED_PROXY_RUNTIME_KEY,
        sharedState.port,
        apiPort,
        { forceRestart: false }
      );
      return;
    }

    for (const [profileId, runtime] of this.runtimes) {
      await this.ensureTrafficIngress(profileId, runtime.port, runtime.apiPort, {
        forceRestart: false,
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
        const apiPort = this.resolveApiPort(status.port, status.apiPort);
        await this.ensureTrafficIngress(profile.id, status.port, apiPort, {
          forceRestart: false,
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
    const config = vscode.workspace.getConfiguration('cursorAccounts.proxy');
    const maxLogSizeMb = config.get<number>('maxLogSizeMB', 500);
    const maxBodyLogMb = config.get<number>('maxBodyLogMB', 4);
    const apiPortOffset = config.get<number>('apiPortOffset', 10_000);
    return {
      port,
      apiPort: port + apiPortOffset,
      profileId: profile.id,
      storageDir: this.storageDir,
      logDir: this.logDir,
      maxLogSizeMb,
      maxBodyLogBytes: Math.max(1, Math.floor(maxBodyLogMb * 1024 * 1024)),
      spillLargeBodies: config.get<boolean>('spillLargeBodies', true),
      developmentMode: this.isProfileJsonlLogging(profile),
      trafficDiagnostics: config.get<boolean>('trafficDiagnostics', true),
      diagnosticsIntervalMs: config.get<number>('diagnosticsIntervalMs', 30_000),
      ...overrides,
    };
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

  private async pollProxyHealth(
    apiPort: number,
    timeoutMs: number,
    options?: {
      getStderr?: () => string;
      isProcessAlive?: () => boolean;
    }
  ): Promise<{ success: boolean; error?: string }> {
    const baseUrl = buildProxyApiBaseUrl(apiPort);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (options?.isProcessAlive && !options.isProcessAlive()) {
        const stderr = options.getStderr?.().trim();
        return {
          success: false,
          error: stderr
            ? `Proxy process exited before API was ready: ${stderr}`
            : 'Proxy process exited before API was ready',
        };
      }

      try {
        const response = await fetch(`${baseUrl}${PROXY_API_PATHS.health}`);
        if (response.ok) {
          const body = (await response.json()) as ProxyApiHealthResponse;
          if (body.ok) {
            return { success: true };
          }
        }
      } catch {
        // API not ready yet.
      }

      await new Promise((resolve) => setTimeout(resolve, PROXY_HEALTH_POLL_MS));
    }

    const stderr = options?.getStderr?.().trim();
    return {
      success: false,
      error: stderr
        ? `Proxy did not become ready within ${timeoutMs}ms: ${stderr}`
        : `Proxy did not become ready within ${timeoutMs}ms`,
    };
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

    await runtime.process.stop(pid, 'SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, PROXY_STOP_GRACE_MS));
    if (pid != null && runtime.process.isAlive(pid)) {
      await runtime.process.stop(pid, 'SIGKILL');
    }
    nodeProcess?.detach();
  }
}

export { PROXY_STATE_FILE_NAME };
