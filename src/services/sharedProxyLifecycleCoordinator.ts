import * as fs from 'fs/promises';
import {
  isProfileProxyEnabled,
  type Profile,
} from '@cursor-accounts/types';
import type { ProxyStartResult } from '../domain/ports/IProxyManager';
import type { IProxyCertificateService } from '../domain/ports/IProxyCertificateService';
import type { IProxyProcess } from '../domain/ports/IProxyProcess';
import type { ISharedProxyStateStore } from '../domain/ports/ISharedProxyStateStore';
import type { ProxyServerConfig } from '../application/types/proxyConfig';
import {
  SharedProxyRuntimeStartUseCase,
  type SharedProxyRuntime,
} from '../application/services/sharedProxyRuntimeStartUseCase';
import { pollProxyHealth } from '../proxy/proxyHealthPoller';
import {
  DEFAULT_PROXY_PORT,
  PROXY_STATE_SCHEMA_VERSION,
  SHARED_PROXY_RUNTIME_KEY,
} from '../proxy/types';
import * as extensionLog from '../logging/extensionLog';

const PROXY_START_TIMEOUT_MS = 15_000;

export type { SharedProxyRuntime } from '../application/services/sharedProxyRuntimeStartUseCase';

interface ProxyControlClient {
  getStatus(): Promise<{ running: boolean }>;
  shutdown(): Promise<void>;
}

export interface SharedProxyLifecycleCoordinatorDependencies {
  storageDir: string;
  logDir: string;
  ensureStorageDirectories?(): Promise<void>;
  detachProcess?(process: IProxyProcess): void;
  stateStore: ISharedProxyStateStore;
  certService: IProxyCertificateService;
  createProcess(): IProxyProcess;
  isPortAvailable(port: number): Promise<boolean>;
  createApiClient(apiPort: number, apiToken?: string): ProxyControlClient;
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

  constructor(
    private readonly dependencies: SharedProxyLifecycleCoordinatorDependencies
  ) {
    this.runtimeStarter = createRuntimeStarter(dependencies);
  }

  async ensure(profiles: Profile[]): Promise<ProxyStartResult> {
    const enabledProfiles = profiles.filter(isProfileProxyEnabled);
    if (enabledProfiles.length === 0) {
      return { success: false, error: 'No profiles with proxy enabled' };
    }

    const existing = this.dependencies.getRuntime();
    if (existing) {
      for (const profile of enabledProfiles) {
        await this.dependencies.prepareProfile(profile, existing.port);
        await this.dependencies.ensureTrafficIngress(
          existing.port,
          existing.apiPort,
          { forceRestart: false, apiToken: existing.apiToken }
        );
      }
      return { success: true, port: existing.port };
    }

    const sharedState = await this.dependencies.stateStore.read();
    if (sharedState?.running && sharedState.port != null) {
      const apiPort = this.dependencies.resolveApiPort(
        sharedState.port,
        sharedState.apiPort
      );
      try {
        const probe = this.dependencies.createApiClient(
          apiPort,
          sharedState.apiToken
        );
        const status = await probe.getStatus();
        if (status.running) {
          for (const profile of enabledProfiles) {
            await this.dependencies.prepareProfile(profile, sharedState.port);
          }
          await this.dependencies.ensureTrafficIngress(
            sharedState.port,
            apiPort,
            { forceRestart: true, apiToken: sharedState.apiToken }
          );
          this.dependencies.notifyStatusChange();
          return { success: true, port: sharedState.port };
        }
      } catch {
        await this.dependencies.stateStore.clear();
      }
    }

    if (!(await this.dependencies.isPortAvailable(DEFAULT_PROXY_PORT))) {
      return {
        success: false,
        error: `Shared proxy port ${DEFAULT_PROXY_PORT} is not available`,
      };
    }

    return this.startNewRuntime(enabledProfiles);
  }

  async stop(): Promise<void> {
    if (!this.dependencies.getRuntime()) {
      return;
    }

    const runtime = this.dependencies.getRuntime();
    if (runtime?.apiPort != null) {
      try {
        await this.dependencies
          .createApiClient(runtime.apiPort, runtime.apiToken)
          .shutdown();
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        extensionLog.debug(
          `[Proxy:shared] API shutdown failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    await this.dependencies.stopRuntime();
    this.dependencies.stopTrafficIngress();
    await this.dependencies.stateStore.clear();
    this.dependencies.notifyStatusChange();
  }

  private startNewRuntime(enabledProfiles: Profile[]): Promise<ProxyStartResult> {
    return this.runtimeStarter.execute(enabledProfiles);
  }
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
