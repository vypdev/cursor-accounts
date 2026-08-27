import { ProxyProfileAttachUseCase } from '../application/services/proxyProfileAttachUseCase';
import {
  PROXY_STOP_GRACE_MS,
  ProxyProfileStopUseCase,
} from '../application/services/proxyProfileStopUseCase';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { IProxyControlClient } from '../domain/ports/IProxyControlClient';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import type { IProxyTrafficIngress } from '../domain/ports/IProxyTrafficIngress';
import type { SharedProxyRuntime } from './sharedProxyLifecycleCoordinator';
import type { ISharedProxyStateStore } from '../domain/ports/ISharedProxyStateStore';
import { SHARED_PROXY_RUNTIME_KEY } from '../proxy/types';
import * as extensionLog from '../logging/extensionLog';

export { PROXY_STOP_GRACE_MS };

export interface ProxyProfileLifecycleCoordinatorDependencies {
  profileManager: IProfileReader;
  stateStore: IProxyStateStore;
  sharedStateStore: ISharedProxyStateStore;
  trafficIngress: IProxyTrafficIngress;
  getRuntime(profileId: string): SharedProxyRuntime | undefined;
  isSharedProxyActive(): boolean;
  createApiClient(apiPort: number, apiToken?: string): IProxyControlClient;
  resolveApiPort(mitmPort: number, persistedApiPort?: number): number;
  ensureAgentTracking(profileId: string, userDataDir: string): Promise<void>;
  applyProxySettings(userDataDir: string, port: number): Promise<void>;
  ensureTrafficIngress(
    profileId: string,
    port: number,
    apiPort: number,
    options: { forceRestart: boolean; apiToken?: string }
  ): Promise<void>;
  forceStopChild(profileId: string): Promise<void>;
  restoreProxySettings?(userDataDir: string): Promise<void>;
  appendStopped(): void;
  notifyStatusChange(): void;
}

/** Coordinates attach and cleanup for non-shared profile runtimes. */
export class ProxyProfileLifecycleCoordinator {
  private readonly attachUseCase: ProxyProfileAttachUseCase;
  private readonly stopUseCase: ProxyProfileStopUseCase;

  constructor(dependencies: ProxyProfileLifecycleCoordinatorDependencies) {
    this.attachUseCase = new ProxyProfileAttachUseCase({
      profileManager: dependencies.profileManager,
      stateStore: dependencies.stateStore,
      sharedStateStore: dependencies.sharedStateStore,
      sharedRuntimeId: SHARED_PROXY_RUNTIME_KEY,
      createApiClient: (apiPort, apiToken) =>
        dependencies.createApiClient(apiPort, apiToken),
      resolveApiPort: (mitmPort, persistedApiPort) =>
        dependencies.resolveApiPort(mitmPort, persistedApiPort),
      ensureAgentTracking: (profileId, userDataDir) =>
        dependencies.ensureAgentTracking(profileId, userDataDir),
      applyProxySettings: (userDataDir, port) =>
        dependencies.applyProxySettings(userDataDir, port),
      ensureTrafficIngress: (profileId, port, apiPort, options) =>
        dependencies.ensureTrafficIngress(profileId, port, apiPort, options),
      warn: (message) => extensionLog.warn(message),
      notifyStatusChange: () => dependencies.notifyStatusChange(),
    });
    this.stopUseCase = new ProxyProfileStopUseCase({
      profileManager: dependencies.profileManager,
      stateStore: dependencies.stateStore,
      trafficIngress: dependencies.trafficIngress,
      getRuntime: (profileId) => dependencies.getRuntime(profileId),
      isSharedProxyActive: () => dependencies.isSharedProxyActive(),
      createApiClient: (apiPort, apiToken) =>
        dependencies.createApiClient(apiPort, apiToken),
      resolveApiPort: (mitmPort, persistedApiPort) =>
        dependencies.resolveApiPort(mitmPort, persistedApiPort),
      forceStopChild: (profileId) => dependencies.forceStopChild(profileId),
      restoreProxySettings: dependencies.restoreProxySettings
        ? (userDataDir) => dependencies.restoreProxySettings!(userDataDir)
        : undefined,
      wait: (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)),
      logDebug: (message) => extensionLog.debug(message),
      logError: (message) => extensionLog.error(message),
      logInfo: (message) => extensionLog.info(message),
      logWarn: (message) => extensionLog.warn(message),
      appendStopped: () => dependencies.appendStopped(),
      notifyStatusChange: () => dependencies.notifyStatusChange(),
    });
  }

  async connectToExistingProxy(profileId: string): Promise<void> {
    await this.attachUseCase.execute(profileId);
  }

  async stop(
    profileId: string,
    options?: { restoreSettings?: boolean }
  ): Promise<void> {
    await this.stopUseCase.execute(profileId, options);
  }
}
