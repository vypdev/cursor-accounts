import * as path from 'path';
import * as vscode from 'vscode';
import type {
  ConversationUsagePersistedEvent,
} from '../domain/ports/IProxyTraffic';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import type {
  IProxyOutputPresenter,
  ITokenDetectorOutputPresenter,
  ProxyOutputSettings,
} from '../domain/ports/IProxyOutputPresenter';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import {
  type ProxyStateFile,
  type Profile,
} from '@cursor-accounts/types';
import type { ProxyServerConfig } from '../application/types/proxyConfig';
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
  PROXY_STATE_FILE_NAME,
  SHARED_PROXY_RUNTIME_KEY,
  SHARED_PROXY_STATE_FILE_NAME,
} from '../proxy/types';
import type { AgentTrackingService } from './agentTrackingService';
import {
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
import { ProxyTrafficTailerCoordinator } from './proxyTrafficTailerCoordinator';
import { ProxyProfileRoutingConfiguration } from './proxyProfileRoutingConfiguration';
import { ProxyChildProcessStopCoordinator } from './proxyChildProcessStopCoordinator';
import { ProxyServerConfigurationBuilder } from './proxyServerConfigurationBuilder';
import { ProxyManagerOutputCoordinator } from './proxyManagerOutputCoordinator';

export type ProxyManagerRuntime = SharedProxyRuntime;

export interface ProxyManagerCompositionCallbacks {
  notifyStatusChange(): void;
  notifyUsagePersisted(event: ConversationUsagePersistedEvent): void;
}

export interface ProxyManagerCompositionOptions {
  stateStore: IProxyStateStore;
  profileManager: IProfileReader;
  context: vscode.ExtensionContext;
  storageDir?: string;
  profileSettingsManager?: IProfileSettingsManager;
  outputPresenter?: IProxyOutputPresenter;
  tokenDetectorPresenter?: ITokenDetectorOutputPresenter;
  dependencies: ProxyManagerDependencies;
  getOutputConfig: () => ProxyOutputSettings;
  callbacks: ProxyManagerCompositionCallbacks;
  runtimes: Map<string, ProxyManagerRuntime>;
}

export interface ProxyManagerComposition {
  readonly storageDir: string;
  readonly logDir: string;
  readonly agentTrackingCoordinator: ProxyAgentTrackingCoordinator;
  readonly trafficIngressCoordinator: ProxyTrafficIngressCoordinator;
  readonly trafficUsageCoordinator: ProxyTrafficUsageCoordinator;
  readonly sharedProxyLifecycleCoordinator: SharedProxyLifecycleCoordinator;
  readonly profileLifecycleCoordinator: ProxyProfileLifecycleCoordinator;
  readonly statusCoordinator: ProxyStatusCoordinator;
  readonly trafficTailerCoordinator: ProxyTrafficTailerCoordinator;
  readonly outputCoordinator: ProxyManagerOutputCoordinator;

  isSharedProxyActive(): boolean;
  getAgentTrackingService(profileId: string): AgentTrackingService | undefined;
  getApiToken(profileId: string): Promise<string | undefined>;
}

/**
 * Builds the concrete proxy coordinators used by the public ProxyManager
 * facade. This is the composition root for proxy infrastructure; coordinators
 * receive ports and callbacks instead of reaching back into the facade.
 */
export function createProxyManagerComposition(
  options: ProxyManagerCompositionOptions
): ProxyManagerComposition {
  const storageDir = options.storageDir ?? getSharedProxyStorageDir();
  const logDir = path.join(storageDir, 'logs');
  const sharedProxyStateStore =
    options.dependencies.sharedStateStore ??
    new SharedProxyStateStore(
      path.join(storageDir, SHARED_PROXY_STATE_FILE_NAME)
    );

  const getApiPortOffset = (): number =>
    vscode.workspace
      .getConfiguration('cursorAccounts.proxy')
      .get<number>('apiPortOffset', 10_000);

  const resolveApiPort = (mitmPort: number, persistedApiPort?: number): number =>
    resolveProxyApiPort(mitmPort, getApiPortOffset(), persistedApiPort);

  const createApiClient = (
    apiPort: number,
    apiToken?: string
  ): ProxyApiClient =>
    new ProxyApiClient({
      baseUrl: buildProxyApiBaseUrl(apiPort),
      reconnect: false,
      apiToken,
    });

  const agentTrackingCoordinator = new ProxyAgentTrackingCoordinator(
    options.context.extensionPath,
    () =>
      vscode.workspace
        .getConfiguration('cursorAccounts.proxy')
        .get<number>('estimatedDollarsPerMillionTokens', 4),
    {
      onInitialized: (profileId) =>
        options.tokenDetectorPresenter?.appendInitialized(profileId),
    }
  );

  const trafficIngressCoordinator = new ProxyTrafficIngressCoordinator({
    profileManager: options.profileManager,
    trafficIngress: options.dependencies.trafficIngress,
    outputPresenter: options.outputPresenter,
    getOutputConfig: options.getOutputConfig,
    hasRuntime: (profileId) => options.runtimes.has(profileId),
    sharedRuntimeKey: SHARED_PROXY_RUNTIME_KEY,
  });

  const ensureTrafficIngress = async (
    profileId: string,
    mitmPort: number,
    apiPort: number,
    ingressOptions?: {
      forceRestart?: boolean;
      tailFromStart?: boolean;
      apiToken?: string;
    }
  ): Promise<void> => {
    await trafficIngressCoordinator.ensure(
      profileId,
      mitmPort,
      apiPort,
      ingressOptions
    );
  };

  const trafficUsageCoordinator = new ProxyTrafficUsageCoordinator({
    isSharedProxyActive: () => options.runtimes.has(SHARED_PROXY_RUNTIME_KEY),
    ensureAgentTracking: (profileId) =>
      agentTrackingCoordinator.ensureForProfile(
        profileId,
        options.profileManager
      ),
    getAgentTrackingService: (profileId) =>
      agentTrackingCoordinator.get(profileId),
    onUsagePersisted: (event) => options.callbacks.notifyUsagePersisted(event),
  });

  const serverConfigurationBuilder = new ProxyServerConfigurationBuilder({
    storageDir,
    logDir,
    getConfig: (key, fallback) =>
      vscode.workspace
        .getConfiguration('cursorAccounts.proxy')
        .get(key, fallback),
    isJsonlLoggingEnabled: (profile) => profile.proxyJsonlLoggingEnabled === true,
  });

  const buildServerConfig = (
    port: number,
    profile: Profile,
    overrides?: Partial<ProxyServerConfig>
  ): ProxyServerConfig =>
    serverConfigurationBuilder.build(port, profile, {
      ...overrides,
      extensionPath: options.context.extensionPath,
    });

  const ensureAgentTracking = async (
    profileId: string,
    userDataDir: string
  ): Promise<void> => {
    await agentTrackingCoordinator.ensure(profileId, userDataDir);
  };

  const applyProxySettings = async (
    userDataDir: string,
    port: number
  ): Promise<void> => {
    if (!options.profileSettingsManager) {
      return;
    }
    try {
      await options.profileSettingsManager.applyProxySettings(
        userDataDir,
        `http://127.0.0.1:${port}`
      );
    } catch (error) {
      extensionLog.warn(
        `[Proxy] Failed to apply proxy settings: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  const profileRoutingConfiguration = new ProxyProfileRoutingConfiguration({
    authReader: options.dependencies.authReader,
  });

  const childProcessStopCoordinator = new ProxyChildProcessStopCoordinator({
    getRuntime: (profileId) => options.runtimes.get(profileId),
    deleteRuntime: (profileId) => options.runtimes.delete(profileId),
    deleteAgentTracking: (profileId) => agentTrackingCoordinator.delete(profileId),
    stateStore: options.stateStore,
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

  const forceStopChild = async (profileId: string): Promise<void> => {
    await childProcessStopCoordinator.stop(profileId);
  };

  const readSharedProxyState = async (): Promise<ProxyStateFile | null> =>
    sharedProxyStateStore.read();

  const buildUserIdMapping = async (
    profiles: Profile[]
  ): Promise<Map<string, string>> =>
    profileRoutingConfiguration.buildUserIdMapping(profiles);

  const buildProfileDbPaths = (profiles: Profile[]): Record<string, string> =>
    profileRoutingConfiguration.buildProfileDbPaths(profiles);

  const sharedProxyLifecycleCoordinator =
    new SharedProxyLifecycleCoordinator({
      storageDir,
      logDir,
      stateStore: sharedProxyStateStore,
      certService: options.dependencies.certService,
      createProcess: options.dependencies.createProcess,
      isPortAvailable: (port) => isPortAvailable(port),
      createApiClient,
      resolveApiPort,
      buildServerConfig,
      buildUserIdMapping,
      buildProfileDbPaths,
      prepareProfile: async (profile, port) => {
        await ensureAgentTracking(profile.id, profile.userDataDir);
        await applyProxySettings(profile.userDataDir, port);
      },
      ensureTrafficIngress: (port, apiPort, ingressOptions) =>
        ensureTrafficIngress(
          SHARED_PROXY_RUNTIME_KEY,
          port,
          apiPort,
          ingressOptions
        ),
      stopTrafficIngress: () => options.dependencies.trafficIngress.stopAll(),
      getRuntime: () => options.runtimes.get(SHARED_PROXY_RUNTIME_KEY),
      setRuntime: (runtime) =>
        options.runtimes.set(SHARED_PROXY_RUNTIME_KEY, runtime),
      deleteRuntime: () => options.runtimes.delete(SHARED_PROXY_RUNTIME_KEY),
      stopRuntime: () => forceStopChild(SHARED_PROXY_RUNTIME_KEY),
      appendStarted: (port) => options.outputPresenter?.appendStarted(port),
      showOutput: () => options.outputPresenter?.show(),
      shouldAutoShowOutput: () =>
        options.getOutputConfig().autoShowOutputChannel,
      notifyStatusChange: () => options.callbacks.notifyStatusChange(),
    });

  const profileLifecycleCoordinator = new ProxyProfileLifecycleCoordinator({
    profileManager: options.profileManager,
    stateStore: options.stateStore,
    sharedStateStore: sharedProxyStateStore,
    trafficIngress: options.dependencies.trafficIngress,
    getRuntime: (profileId) => options.runtimes.get(profileId),
    isSharedProxyActive: () => options.runtimes.has(SHARED_PROXY_RUNTIME_KEY),
    createApiClient,
    resolveApiPort,
    ensureAgentTracking,
    applyProxySettings,
    ensureTrafficIngress,
    forceStopChild,
    restoreProxySettings: options.profileSettingsManager
      ? (userDataDir) =>
          options.profileSettingsManager!.restoreProxySettings(userDataDir)
      : undefined,
    appendStopped: () => options.outputPresenter?.appendStopped(),
    notifyStatusChange: () => options.callbacks.notifyStatusChange(),
  });

  const getRuntimePid = (runtime: ProxyManagerRuntime): number | null =>
    runtime.process instanceof NodeProxyProcess
      ? runtime.process.getChild()?.pid ?? null
      : null;

  const statusCoordinator = new ProxyStatusCoordinator({
    profileManager: options.profileManager,
    stateStore: options.stateStore,
    logDirectory: logDir,
    getRuntime: (profileId) => options.runtimes.get(profileId),
    readSharedState: readSharedProxyState,
    resolveApiPort,
    getRuntimePid,
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

  const getApiToken = async (profileId: string): Promise<string | undefined> => {
    const runtime = options.runtimes.get(profileId);
    if (runtime?.apiToken) {
      return runtime.apiToken;
    }
    const sharedRuntime = options.runtimes.get(SHARED_PROXY_RUNTIME_KEY);
    if (sharedRuntime?.apiToken) {
      return sharedRuntime.apiToken;
    }
    const sharedState = await readSharedProxyState();
    if (sharedState?.apiToken) {
      return sharedState.apiToken;
    }
    const profile = await options.profileManager.getProfile(profileId);
    if (!profile) {
      return undefined;
    }
    return (await options.stateStore.read(profile.userDataDir))?.apiToken;
  };

  const trafficTailerCoordinator = new ProxyTrafficTailerCoordinator({
    profileManager: options.profileManager,
    getRuntime: (profileId) => options.runtimes.get(profileId),
    runtimes: () => options.runtimes,
    readSharedState: readSharedProxyState,
    getStatus: (profileId) => statusCoordinator.getStatus(profileId),
    isRunning: async (profileId) =>
      (await statusCoordinator.getStatus(profileId))?.running === true,
    resolveApiPort,
    getApiToken,
    ensureTrafficIngress,
  });

  const outputCoordinator = new ProxyManagerOutputCoordinator({
    logDir,
    getOutputConfig: options.getOutputConfig,
    getRuntimeCount: () => options.runtimes.size,
    outputPresenter: options.outputPresenter,
    tokenDetectorPresenter: options.tokenDetectorPresenter,
    ensureOutputTailer: (profileId, tailerOptions) =>
      trafficTailerCoordinator.ensureOutputTailer(profileId, tailerOptions),
    ensureTrafficTailer: () => trafficTailerCoordinator.ensureTrafficTailer(),
  });

  return {
    storageDir,
    logDir,
    agentTrackingCoordinator,
    trafficIngressCoordinator,
    trafficUsageCoordinator,
    sharedProxyLifecycleCoordinator,
    profileLifecycleCoordinator,
    statusCoordinator,
    trafficTailerCoordinator,
    outputCoordinator,
    isSharedProxyActive: () => options.runtimes.has(SHARED_PROXY_RUNTIME_KEY),
    getAgentTrackingService: (profileId) =>
      agentTrackingCoordinator.get(profileId),
    getApiToken,
  };
}

export { PROXY_STATE_FILE_NAME };
