import * as path from 'path';
import * as vscode from 'vscode';
import type { ConversationUsagePersistedEvent } from '../domain/ports/IProxyTraffic';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import type {
  IProxyOutputPresenter,
  ITokenDetectorOutputPresenter,
  ProxyOutputSettings,
} from '../domain/ports/IProxyOutputPresenter';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import type { ISharedProxyStateStore } from '../domain/ports/ISharedProxyStateStore';
import type {
  Profile,
  ProxyStateFile,
} from '@cursor-accounts/types';
import type { ProxyServerConfig } from '../application/types/proxyConfig';
import type { ProxySettingsApplicationService } from '../application/services/proxySettingsApplicationService';
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
import type { ProxyManagerDependencies } from './proxyManagerDefaultDependencies';
import { ProxyAgentTrackingCoordinator } from './proxyAgentTrackingCoordinator';
import { ProxyTrafficIngressCoordinator } from './proxyTrafficIngressCoordinator';
import { ProxyTrafficUsageCoordinator } from './proxyTrafficUsageCoordinator';
import { ProxyProfileLifecycleCoordinator } from './proxyProfileLifecycleCoordinator';
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
  proxySettingsApplicationService?: Pick<
    ProxySettingsApplicationService,
    'applyProxySettings'
  >;
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

interface CompositionPaths {
  storageDir: string;
  logDir: string;
}

interface CompositionFoundations {
  sharedProxyStateStore: ISharedProxyStateStore;
  agentTrackingCoordinator: ProxyAgentTrackingCoordinator;
  trafficIngressCoordinator: ProxyTrafficIngressCoordinator;
  trafficUsageCoordinator: ProxyTrafficUsageCoordinator;
  resolveApiPort: (mitmPort: number, persistedApiPort?: number) => number;
  createApiClient: (apiPort: number, apiToken?: string) => ProxyApiClient;
  buildServerConfig: (
    port: number,
    profile: Profile,
    overrides?: Partial<ProxyServerConfig>
  ) => ProxyServerConfig;
  ensureAgentTracking: (profileId: string, userDataDir: string) => Promise<void>;
  applyProxySettings: (userDataDir: string, port: number) => Promise<void>;
  ensureTrafficIngress: (
    profileId: string,
    mitmPort: number,
    apiPort: number,
    options?: {
      forceRestart?: boolean;
      tailFromStart?: boolean;
      apiToken?: string;
    }
  ) => Promise<void>;
  forceStopChild: (profileId: string) => Promise<void>;
  readSharedProxyState: () => Promise<ProxyStateFile | null>;
  buildUserIdMapping: (profiles: Profile[]) => Promise<Map<string, string>>;
  buildProfileDbPaths: (profiles: Profile[]) => Record<string, string>;
}

interface LifecycleCoordinators {
  sharedProxyLifecycleCoordinator: SharedProxyLifecycleCoordinator;
  profileLifecycleCoordinator: ProxyProfileLifecycleCoordinator;
}

interface ReadModelCoordinators {
  statusCoordinator: ProxyStatusCoordinator;
  trafficTailerCoordinator: ProxyTrafficTailerCoordinator;
  outputCoordinator: ProxyManagerOutputCoordinator;
  getApiToken: (profileId: string) => Promise<string | undefined>;
}

/**
 * Builds the concrete proxy coordinators used by the public ProxyManager
 * facade. This is the composition root for proxy infrastructure; coordinators
 * receive ports and callbacks instead of reaching back into the facade.
 */
export function createProxyManagerComposition(
  options: ProxyManagerCompositionOptions
): ProxyManagerComposition {
  const paths = resolveCompositionPaths(options.storageDir);
  const foundations = createCompositionFoundations(options, paths);
  const lifecycle = createLifecycleCoordinators(options, paths, foundations);
  const readModels = createReadModelCoordinators(options, paths, foundations);

  return {
    storageDir: paths.storageDir,
    logDir: paths.logDir,
    agentTrackingCoordinator: foundations.agentTrackingCoordinator,
    trafficIngressCoordinator: foundations.trafficIngressCoordinator,
    trafficUsageCoordinator: foundations.trafficUsageCoordinator,
    sharedProxyLifecycleCoordinator: lifecycle.sharedProxyLifecycleCoordinator,
    profileLifecycleCoordinator: lifecycle.profileLifecycleCoordinator,
    statusCoordinator: readModels.statusCoordinator,
    trafficTailerCoordinator: readModels.trafficTailerCoordinator,
    outputCoordinator: readModels.outputCoordinator,
    isSharedProxyActive: () => options.runtimes.has(SHARED_PROXY_RUNTIME_KEY),
    getAgentTrackingService: (profileId) =>
      foundations.agentTrackingCoordinator.get(profileId),
    getApiToken: readModels.getApiToken,
  };
}

function resolveCompositionPaths(storageDir?: string): CompositionPaths {
  const resolvedStorageDir = storageDir ?? getSharedProxyStorageDir();
  return {
    storageDir: resolvedStorageDir,
    logDir: path.join(resolvedStorageDir, 'logs'),
  };
}

function createCompositionFoundations(
  options: ProxyManagerCompositionOptions,
  paths: CompositionPaths
): CompositionFoundations {
  const sharedProxyStateStore =
    options.dependencies.sharedStateStore ??
    new SharedProxyStateStore(
      path.join(paths.storageDir, SHARED_PROXY_STATE_FILE_NAME)
    );
  const resolveApiPort = createApiPortResolver();
  const agentTrackingCoordinator = createAgentTrackingCoordinator(options);
  const trafficIngressCoordinator = createTrafficIngressCoordinator(options);
  const ensureTrafficIngress = createTrafficIngressEnsurer(
    trafficIngressCoordinator
  );
  const trafficUsageCoordinator = createTrafficUsageCoordinator(
    options,
    agentTrackingCoordinator
  );
  const buildServerConfig = createServerConfigBuilder(options, paths);
  const ensureAgentTracking = createAgentTrackingEnsurer(
    agentTrackingCoordinator
  );
  const applyProxySettings = createProxySettingsApplier(options);
  const profileRoutingConfiguration = new ProxyProfileRoutingConfiguration({
    authReader: options.dependencies.authReader,
  });
  const childProcessStopCoordinator = createChildProcessStopCoordinator(
    options,
    agentTrackingCoordinator
  );

  return {
    sharedProxyStateStore,
    agentTrackingCoordinator,
    trafficIngressCoordinator,
    trafficUsageCoordinator,
    resolveApiPort,
    createApiClient: createProxyApiClient,
    buildServerConfig,
    ensureAgentTracking,
    applyProxySettings,
    ensureTrafficIngress,
    forceStopChild: (profileId) => childProcessStopCoordinator.stop(profileId),
    readSharedProxyState: () => sharedProxyStateStore.read(),
    buildUserIdMapping: (profiles) =>
      profileRoutingConfiguration.buildUserIdMapping(profiles),
    buildProfileDbPaths: (profiles) =>
      profileRoutingConfiguration.buildProfileDbPaths(profiles),
  };
}

function createApiPortResolver(): (
  mitmPort: number,
  persistedApiPort?: number
) => number {
  return (mitmPort, persistedApiPort) => {
    const offset = vscode.workspace
      .getConfiguration('cursorAccounts.proxy')
      .get<number>('apiPortOffset', 10_000);
    return resolveProxyApiPort(mitmPort, offset, persistedApiPort);
  };
}

function createProxyApiClient(
  apiPort: number,
  apiToken?: string
): ProxyApiClient {
  return new ProxyApiClient({
    baseUrl: buildProxyApiBaseUrl(apiPort),
    reconnect: false,
    apiToken,
  });
}

function createAgentTrackingCoordinator(
  options: ProxyManagerCompositionOptions
): ProxyAgentTrackingCoordinator {
  return new ProxyAgentTrackingCoordinator(
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
}

function createTrafficIngressCoordinator(
  options: ProxyManagerCompositionOptions
): ProxyTrafficIngressCoordinator {
  return new ProxyTrafficIngressCoordinator({
    profileManager: options.profileManager,
    trafficIngress: options.dependencies.trafficIngress,
    outputPresenter: options.outputPresenter,
    getOutputConfig: options.getOutputConfig,
    hasRuntime: (profileId) => options.runtimes.has(profileId),
    sharedRuntimeKey: SHARED_PROXY_RUNTIME_KEY,
  });
}

function createTrafficIngressEnsurer(
  coordinator: ProxyTrafficIngressCoordinator
): CompositionFoundations['ensureTrafficIngress'] {
  return (profileId, mitmPort, apiPort, ingressOptions) =>
    coordinator.ensure(profileId, mitmPort, apiPort, ingressOptions);
}

function createTrafficUsageCoordinator(
  options: ProxyManagerCompositionOptions,
  agentTrackingCoordinator: ProxyAgentTrackingCoordinator
): ProxyTrafficUsageCoordinator {
  return new ProxyTrafficUsageCoordinator({
    isSharedProxyActive: () => options.runtimes.has(SHARED_PROXY_RUNTIME_KEY),
    ensureAgentTracking: (profileId) =>
      agentTrackingCoordinator.ensureForProfile(
        profileId,
        options.profileManager
      ),
    getAgentTrackingService: (profileId) =>
      agentTrackingCoordinator.get(profileId),
    onUsagePersisted: (event) => options.callbacks.notifyUsagePersisted(event),
    logger: {
      info: (message) => extensionLog.info(message),
      warn: (message) => extensionLog.warn(message),
    },
  });
}

function createServerConfigBuilder(
  options: ProxyManagerCompositionOptions,
  paths: CompositionPaths
): CompositionFoundations['buildServerConfig'] {
  const builder = new ProxyServerConfigurationBuilder({
    storageDir: paths.storageDir,
    logDir: paths.logDir,
    getConfig: (key, fallback) =>
      vscode.workspace
        .getConfiguration('cursorAccounts.proxy')
        .get(key, fallback),
    isJsonlLoggingEnabled: (profile) => profile.proxyJsonlLoggingEnabled === true,
  });
  return (port, profile, overrides = {}) =>
    builder.build(port, profile, {
      ...overrides,
      extensionPath: options.context.extensionPath,
    });
}

function createAgentTrackingEnsurer(
  coordinator: ProxyAgentTrackingCoordinator
): CompositionFoundations['ensureAgentTracking'] {
  return (profileId, userDataDir) => coordinator.ensure(profileId, userDataDir);
}

function createProxySettingsApplier(
  options: ProxyManagerCompositionOptions
): CompositionFoundations['applyProxySettings'] {
  return async (userDataDir, port) => {
    if (!options.proxySettingsApplicationService && !options.profileSettingsManager) {
      return;
    }
    try {
      const proxyUrl = `http://127.0.0.1:${port}`;
      if (options.proxySettingsApplicationService) {
        await options.proxySettingsApplicationService.applyProxySettings(
          userDataDir,
          proxyUrl
        );
      } else {
        await options.profileSettingsManager!.applyProxySettings(
          userDataDir,
          proxyUrl
        );
      }
    } catch (error) {
      extensionLog.warn(
        `[Proxy] Failed to apply proxy settings: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };
}

function createChildProcessStopCoordinator(
  options: ProxyManagerCompositionOptions,
  agentTrackingCoordinator: ProxyAgentTrackingCoordinator
): ProxyChildProcessStopCoordinator {
  return new ProxyChildProcessStopCoordinator({
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
}

function createLifecycleCoordinators(
  options: ProxyManagerCompositionOptions,
  paths: CompositionPaths,
  foundations: CompositionFoundations
): LifecycleCoordinators {
  const sharedProxyLifecycleCoordinator =
    new SharedProxyLifecycleCoordinator({
      storageDir: paths.storageDir,
      logDir: paths.logDir,
      stateStore: foundations.sharedProxyStateStore,
      certService: options.dependencies.certService,
      createProcess: options.dependencies.createProcess,
      detachProcess: (process) => {
        if (process instanceof NodeProxyProcess) {
          process.detach();
        }
      },
      isPortAvailable: (port) => isPortAvailable(port),
      createApiClient: foundations.createApiClient,
      resolveApiPort: foundations.resolveApiPort,
      buildServerConfig: foundations.buildServerConfig,
      buildUserIdMapping: foundations.buildUserIdMapping,
      buildProfileDbPaths: foundations.buildProfileDbPaths,
      prepareProfile: async (profile, port) => {
        await foundations.ensureAgentTracking(profile.id, profile.userDataDir);
        await foundations.applyProxySettings(profile.userDataDir, port);
      },
      ensureTrafficIngress: (port, apiPort, ingressOptions) =>
        foundations.ensureTrafficIngress(
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
      stopRuntime: () => foundations.forceStopChild(SHARED_PROXY_RUNTIME_KEY),
      appendStarted: (port) => options.outputPresenter?.appendStarted(port),
      showOutput: () => options.outputPresenter?.show(),
      shouldAutoShowOutput: () =>
        options.getOutputConfig().autoShowOutputChannel,
      notifyStatusChange: () => options.callbacks.notifyStatusChange(),
    });
  const profileLifecycleCoordinator = new ProxyProfileLifecycleCoordinator({
    profileManager: options.profileManager,
    stateStore: options.stateStore,
    sharedStateStore: foundations.sharedProxyStateStore,
    trafficIngress: options.dependencies.trafficIngress,
    getRuntime: (profileId) => options.runtimes.get(profileId),
    isSharedProxyActive: () => options.runtimes.has(SHARED_PROXY_RUNTIME_KEY),
    createApiClient: foundations.createApiClient,
    resolveApiPort: foundations.resolveApiPort,
    ensureAgentTracking: foundations.ensureAgentTracking,
    applyProxySettings: foundations.applyProxySettings,
    ensureTrafficIngress: foundations.ensureTrafficIngress,
    forceStopChild: foundations.forceStopChild,
    restoreProxySettings: options.profileSettingsManager
      ? (userDataDir) =>
          options.profileSettingsManager!.restoreProxySettings(userDataDir)
      : undefined,
    appendStopped: () => options.outputPresenter?.appendStopped(),
    notifyStatusChange: () => options.callbacks.notifyStatusChange(),
  });

  return {
    sharedProxyLifecycleCoordinator,
    profileLifecycleCoordinator,
  };
}

function createReadModelCoordinators(
  options: ProxyManagerCompositionOptions,
  paths: CompositionPaths,
  foundations: CompositionFoundations
): ReadModelCoordinators {
  const statusCoordinator = new ProxyStatusCoordinator({
    profileManager: options.profileManager,
    stateStore: options.stateStore,
    logDirectory: paths.logDir,
    getRuntime: (profileId) => options.runtimes.get(profileId),
    readSharedState: foundations.readSharedProxyState,
    resolveApiPort: foundations.resolveApiPort,
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
  const getApiToken = async (
    profileId: string
  ): Promise<string | undefined> => {
    const runtime = options.runtimes.get(profileId);
    if (runtime?.apiToken) {
      return runtime.apiToken;
    }
    const sharedRuntime = options.runtimes.get(SHARED_PROXY_RUNTIME_KEY);
    if (sharedRuntime?.apiToken) {
      return sharedRuntime.apiToken;
    }
    const sharedState = await foundations.readSharedProxyState();
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
    readSharedState: foundations.readSharedProxyState,
    getStatus: (profileId) => statusCoordinator.getStatus(profileId),
    isRunning: async (profileId) =>
      (await statusCoordinator.getStatus(profileId))?.running === true,
    resolveApiPort: foundations.resolveApiPort,
    getApiToken,
    ensureTrafficIngress: foundations.ensureTrafficIngress,
  });
  const outputCoordinator = new ProxyManagerOutputCoordinator({
    logDir: paths.logDir,
    getOutputConfig: options.getOutputConfig,
    getRuntimeCount: () => options.runtimes.size,
    outputPresenter: options.outputPresenter,
    tokenDetectorPresenter: options.tokenDetectorPresenter,
    ensureOutputTailer: (profileId, tailerOptions) =>
      trafficTailerCoordinator.ensureOutputTailer(profileId, tailerOptions),
    ensureTrafficTailer: () => trafficTailerCoordinator.ensureTrafficTailer(),
  });

  return {
    statusCoordinator,
    trafficTailerCoordinator,
    outputCoordinator,
    getApiToken,
  };
}

function getRuntimePid(runtime: ProxyManagerRuntime): number | null {
  return runtime.process instanceof NodeProxyProcess
    ? runtime.process.getChild()?.pid ?? null
    : null;
}

export { PROXY_STATE_FILE_NAME };
