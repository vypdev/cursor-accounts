import * as fs from 'fs/promises';
import {
  isProfileProxyEnabled,
  type Profile,
  type ProxyStateFile,
} from '@cursor-accounts/types';
import type { ProxyStartResult } from '../domain/ports/IProxyManager';
import type { IProxyCertificateService } from '../domain/ports/IProxyCertificateService';
import type { IProxyProcess } from '../domain/ports/IProxyProcess';
import type { ISharedProxyStateStore } from '../domain/ports/ISharedProxyStateStore';
import type { ProxyServerConfig } from '../application/types/proxyConfig';
import { pollProxyHealth } from '../proxy/proxyHealthPoller';
import {
  DEFAULT_PROXY_PORT,
  PROXY_STATE_SCHEMA_VERSION,
  SHARED_PROXY_RUNTIME_KEY,
} from '../proxy/types';
import { NodeProxyProcess } from '../proxy/nodeProxyProcess';
import * as extensionLog from '../logging/extensionLog';

const PROXY_START_TIMEOUT_MS = 15_000;

export interface SharedProxyRuntime {
  process: IProxyProcess;
  port: number;
  apiPort: number;
  userDataDir: string;
  apiToken?: string;
}

interface ProxyControlClient {
  getStatus(): Promise<{ running: boolean }>;
  shutdown(): Promise<void>;
}

export interface SharedProxyLifecycleCoordinatorDependencies {
  storageDir: string;
  logDir: string;
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
  constructor(
    private readonly dependencies: SharedProxyLifecycleCoordinatorDependencies
  ) {}

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

  private async startNewRuntime(
    enabledProfiles: Profile[]
  ): Promise<ProxyStartResult> {
    const port = DEFAULT_PROXY_PORT;
    await fs.mkdir(this.dependencies.storageDir, { recursive: true });
    await fs.mkdir(this.dependencies.logDir, { recursive: true });
    const caPath = await this.dependencies.certService.ensureCaCertificate();
    const anchorProfile = enabledProfiles[0]!;
    const userIdToProfileId = await this.dependencies.buildUserIdMapping(
      enabledProfiles
    );
    const profileDbPaths = this.dependencies.buildProfileDbPaths(enabledProfiles);
    const serverConfig = this.dependencies.buildServerConfig(
      port,
      anchorProfile,
      {
        profileId: SHARED_PROXY_RUNTIME_KEY,
        userIdToProfileId: Object.fromEntries(userIdToProfileId),
        profileDbPaths,
      }
    );

    const proxyProcess = this.dependencies.createProcess();
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
      this.dependencies.deleteRuntime();
      void this.dependencies.stateStore.clear();
      this.dependencies.stopTrafficIngress();
      this.dependencies.notifyStatusChange();
    });

    const runtime = await proxyProcess.start(serverConfig);
    const ready = await pollProxyHealth(
      serverConfig.apiPort,
      PROXY_START_TIMEOUT_MS,
      {
        getStderr: () => stderrLines.join('\n'),
        isProcessAlive: () =>
          runtime.pid != null && proxyProcess.isAlive(runtime.pid),
      },
      serverConfig.apiToken
    );
    if (!ready.success) {
      await proxyProcess.stop(runtime.pid, 'SIGKILL');
      if (proxyProcess instanceof NodeProxyProcess) {
        proxyProcess.detach();
      }
      return { success: false, error: ready.error };
    }

    this.dependencies.setRuntime({
      process: proxyProcess,
      port,
      apiPort: serverConfig.apiPort,
      userDataDir: this.dependencies.storageDir,
      apiToken: serverConfig.apiToken,
    });

    const now = new Date().toISOString();
    const state: ProxyStateFile = {
      version: PROXY_STATE_SCHEMA_VERSION,
      profileId: SHARED_PROXY_RUNTIME_KEY,
      running: true,
      port,
      apiPort: serverConfig.apiPort,
      apiToken: serverConfig.apiToken,
      pid: runtime.pid,
      startedAt: now,
      caCertificatePath: caPath,
      lastUpdatedAt: now,
    };
    await this.dependencies.stateStore.write(state);

    extensionLog.info(
      `[Proxy:shared] Started MITM on 127.0.0.1:${port}, API on 127.0.0.1:${serverConfig.apiPort} (pid ${runtime.pid})`
    );
    this.dependencies.appendStarted(port);

    for (const profile of enabledProfiles) {
      await this.dependencies.prepareProfile(profile, port);
    }

    await this.dependencies.ensureTrafficIngress(
      port,
      serverConfig.apiPort,
      { forceRestart: true, apiToken: serverConfig.apiToken }
    );

    if (this.dependencies.shouldAutoShowOutput()) {
      this.dependencies.showOutput();
    }

    this.dependencies.notifyStatusChange();
    return { success: true, port };
  }
}
