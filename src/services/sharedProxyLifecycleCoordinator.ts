import * as fs from 'fs/promises';
import type { Profile } from '@cursor-accounts/types';
import type { IProxyControlClient } from '../domain/ports/IProxyControlClient';
import type { ProxyStartResult } from '../domain/ports/IProxyManager';
import type { IProxyCertificateService } from '../domain/ports/IProxyCertificateService';
import type { IProxyProcess } from '../domain/ports/IProxyProcess';
import type { ISharedProxyStateStore } from '../domain/ports/ISharedProxyStateStore';
import type { ProxyServerConfig } from '../application/types/proxyConfig';
import {
  SharedProxyRuntimeStartUseCase,
  type SharedProxyRuntime,
} from '../application/services/sharedProxyRuntimeStartUseCase';
import { SharedProxyRuntimeEnsureUseCase } from '../application/services/sharedProxyRuntimeEnsureUseCase';
import { SharedProxyRuntimeStopUseCase } from '../application/services/sharedProxyRuntimeStopUseCase';
import { pollProxyHealth } from '../proxy/proxyHealthPoller';
import {
  DEFAULT_PROXY_PORT,
  PROXY_STATE_SCHEMA_VERSION,
  SHARED_PROXY_RUNTIME_KEY,
} from '../proxy/types';
import * as extensionLog from '../logging/extensionLog';

const PROXY_START_TIMEOUT_MS = 15_000;

export type { SharedProxyRuntime } from '../application/services/sharedProxyRuntimeStartUseCase';

export interface SharedProxyLifecycleCoordinatorDependencies {
  storageDir: string;
  logDir: string;
  ensureStorageDirectories?(): Promise<void>;
  detachProcess?(process: IProxyProcess): void;
  stateStore: ISharedProxyStateStore;
  certService: IProxyCertificateService;
  createProcess(): IProxyProcess;
  isPortAvailable(port: number): Promise<boolean>;
  createApiClient(apiPort: number, apiToken?: string): IProxyControlClient;
  resolveApiPort(mitmPort: number, persistedApiPort?: number): number;
  buildServerConfig(
    port: number,
    profile: Profile,
    overrides: Partial<ProxyServerConfig>
  ): ProxyServerConfig;
  buildUserIdMapping(profiles: Profile[]): Promise<Map<string, string>>;
  buildProfileDbPaths(profiles: Profile[]): Record<string, string>;
  prepareProfile(profile: Profile, port: number): Promise<void>;
  ensureTrafficIngress(
    port: number,
    apiPort: number,
    options: {
      forceRestart: boolean;
      apiToken?: string;
    }
  ): Promise<void>;
  stopTrafficIngress(): void;
  getRuntime(): SharedProxyRuntime | undefined;
  setRuntime(runtime: SharedProxyRuntime): void;
  deleteRuntime(): void;
  stopRuntime(): Promise<void>;
  appendStarted(port: number): void;
  showOutput(): void;
  shouldAutoShowOutput(): boolean;
  notifyStatusChange(): void;
}

/** Owns startup and shutdown decisions for the shared MITM child process. */
export class SharedProxyLifecycleCoordinator {
  private readonly runtimeStarter: SharedProxyRuntimeStartUseCase;
  private readonly runtimeEnsurer: SharedProxyRuntimeEnsureUseCase;
  private readonly runtimeStopper: SharedProxyRuntimeStopUseCase;

  constructor(
    dependencies: SharedProxyLifecycleCoordinatorDependencies
  ) {
    this.runtimeStarter = createRuntimeStarter(dependencies);
    this.runtimeEnsurer = createRuntimeEnsurer(
      dependencies,
      this.runtimeStarter
    );
    this.runtimeStopper = createRuntimeStopper(dependencies);
  }

  async ensure(profiles: Profile[]): Promise<ProxyStartResult> {
    return this.runtimeEnsurer.execute(profiles);
  }

  async stop(): Promise<void> {
    return this.runtimeStopper.execute();
  }
}

function createRuntimeEnsurer(
  dependencies: SharedProxyLifecycleCoordinatorDependencies,
  runtimeStarter: SharedProxyRuntimeStartUseCase
): SharedProxyRuntimeEnsureUseCase {
  return new SharedProxyRuntimeEnsureUseCase({
    sharedProxyPort: DEFAULT_PROXY_PORT,
    stateStore: dependencies.stateStore,
    getRuntime: () => dependencies.getRuntime(),
    resolveApiPort: (mitmPort, persistedApiPort) =>
      dependencies.resolveApiPort(mitmPort, persistedApiPort),
    createApiClient: (apiPort, apiToken) =>
      dependencies.createApiClient(apiPort, apiToken),
    isPortAvailable: (port) => dependencies.isPortAvailable(port),
    prepareProfile: (profile, port) =>
      dependencies.prepareProfile(profile, port),
    ensureTrafficIngress: (port, apiPort, options) =>
      dependencies.ensureTrafficIngress(port, apiPort, options),
    startRuntime: (profiles) => runtimeStarter.execute(profiles),
    notifyStatusChange: () => dependencies.notifyStatusChange(),
  });
}

function createRuntimeStopper(
  dependencies: SharedProxyLifecycleCoordinatorDependencies
): SharedProxyRuntimeStopUseCase {
  return new SharedProxyRuntimeStopUseCase({
    stateStore: dependencies.stateStore,
    getRuntime: () => dependencies.getRuntime(),
    createApiClient: (apiPort, apiToken) =>
      dependencies.createApiClient(apiPort, apiToken),
    wait: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    stopRuntime: () => dependencies.stopRuntime(),
    stopTrafficIngress: () => dependencies.stopTrafficIngress(),
    notifyStatusChange: () => dependencies.notifyStatusChange(),
    logDebug: (message) => extensionLog.debug(message),
  });
}

function createRuntimeStarter(
  dependencies: SharedProxyLifecycleCoordinatorDependencies
): SharedProxyRuntimeStartUseCase {
  return new SharedProxyRuntimeStartUseCase({
    runtimeKey: SHARED_PROXY_RUNTIME_KEY,
    stateSchemaVersion: PROXY_STATE_SCHEMA_VERSION,
    port: DEFAULT_PROXY_PORT,
    userDataDir: dependencies.storageDir,
    stateStore: dependencies.stateStore,
    ensureStorageDirectories: () => ensureStorageDirectories(dependencies),
    ensureCaCertificate: () => dependencies.certService.ensureCaCertificate(),
    createProcess: () => dependencies.createProcess(),
    buildServerConfig: (port, profile, overrides) =>
      dependencies.buildServerConfig(port, profile, overrides),
    buildUserIdMapping: (profiles) => dependencies.buildUserIdMapping(profiles),
    buildProfileDbPaths: (profiles) =>
      dependencies.buildProfileDbPaths(profiles),
    waitForReady: (apiPort, apiToken, options) =>
      pollProxyHealth(apiPort, PROXY_START_TIMEOUT_MS, options, apiToken),
    stopFailedProcess: async (proxyProcess, runtime) => {
      await proxyProcess.stop(runtime.pid, 'SIGKILL');
      dependencies.detachProcess?.(proxyProcess);
    },
    setRuntime: (runtime) => dependencies.setRuntime(runtime),
    prepareProfile: (profile, port) =>
      dependencies.prepareProfile(profile, port),
    ensureTrafficIngress: (port, apiPort, options) =>
      dependencies.ensureTrafficIngress(port, apiPort, options),
    shouldAutoShowOutput: () => dependencies.shouldAutoShowOutput(),
    showOutput: () => dependencies.showOutput(),
    appendStarted: (port) => dependencies.appendStarted(port),
    notifyStatusChange: () => dependencies.notifyStatusChange(),
    onStderrLine: (line) => {
      if (line.includes('[AgentTracking]') || line.includes('[DbPool]')) {
        extensionLog.info(`[Proxy:shared] ${line}`);
      } else {
        extensionLog.debug(`[Proxy:shared] ${line}`);
      }
    },
    onProcessExit: (code) => {
      extensionLog.warn(
        `[Proxy:shared] Child process exited with code ${code ?? 'unknown'}`
      );
      dependencies.deleteRuntime();
      void dependencies.stateStore.clear();
      dependencies.stopTrafficIngress();
      dependencies.notifyStatusChange();
    },
    now: () => new Date().toISOString(),
    logStarted: (message) => extensionLog.info(message),
  });
}

async function ensureStorageDirectories(
  dependencies: SharedProxyLifecycleCoordinatorDependencies
): Promise<void> {
  if (dependencies.ensureStorageDirectories) {
    await dependencies.ensureStorageDirectories();
    return;
  }

  await fs.mkdir(dependencies.storageDir, { recursive: true });
  await fs.mkdir(dependencies.logDir, { recursive: true });
}
