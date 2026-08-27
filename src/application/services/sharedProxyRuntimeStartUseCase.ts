import type { Profile, ProxyStateFile } from '@cursor-accounts/types';
import type { ProxyStartResult } from '../../domain/ports/IProxyManager';
import type {
  IProxyProcess,
  ProxyProcessRuntime,
} from '../../domain/ports/IProxyProcess';
import type { ISharedProxyStateStore } from '../../domain/ports/ISharedProxyStateStore';
import type { ProxyServerConfig } from '../types/proxyConfig';

export interface SharedProxyRuntime {
  process: IProxyProcess;
  port: number;
  apiPort: number;
  userDataDir: string;
  apiToken?: string;
}

export interface ProxyReadinessResult {
  success: boolean;
  error?: string;
}

export interface SharedProxyRuntimeStartUseCaseDependencies {
  runtimeKey: string;
  stateSchemaVersion: number;
  port: number;
  userDataDir: string;
  stateStore: Pick<ISharedProxyStateStore, 'write'>;
  ensureStorageDirectories(): Promise<void>;
  ensureCaCertificate(): Promise<string>;
  createProcess(): IProxyProcess;
  buildServerConfig(
    port: number,
    profile: Profile,
    overrides: Partial<ProxyServerConfig>
  ): ProxyServerConfig;
  buildUserIdMapping(profiles: Profile[]): Promise<Map<string, string>>;
  buildProfileDbPaths(profiles: Profile[]): Record<string, string>;
  waitForReady(
    apiPort: number,
    apiToken: string | undefined,
    options: {
      getStderr(): string;
      isProcessAlive(): boolean;
    }
  ): Promise<ProxyReadinessResult>;
  stopFailedProcess(
    process: IProxyProcess,
    runtime: ProxyProcessRuntime
  ): Promise<void>;
  setRuntime(runtime: SharedProxyRuntime): void;
  prepareProfile(profile: Profile, port: number): Promise<void>;
  ensureTrafficIngress(
    port: number,
    apiPort: number,
    options: {
      forceRestart: boolean;
      apiToken?: string;
    }
  ): Promise<void>;
  shouldAutoShowOutput(): boolean;
  showOutput(): void;
  appendStarted(port: number): void;
  notifyStatusChange(): void;
  onStderrLine(line: string): void;
  onProcessExit(code: number | null): void;
  now(): string;
  logStarted(message: string): void;
}

/** Owns the side-effectful startup transaction for the shared proxy runtime. */
export class SharedProxyRuntimeStartUseCase {
  constructor(
    private readonly dependencies: SharedProxyRuntimeStartUseCaseDependencies
  ) {}

  async execute(profiles: Profile[]): Promise<ProxyStartResult> {
    await this.dependencies.ensureStorageDirectories();
    const caPath = await this.dependencies.ensureCaCertificate();
    const anchorProfile = profiles[0]!;
    const serverConfig = await this.createServerConfig(profiles, anchorProfile);
    const proxyProcess = this.dependencies.createProcess();
    const stderrLines: string[] = [];

    proxyProcess.onStderr((line) => {
      stderrLines.push(line);
      this.dependencies.onStderrLine(line);
    });
    proxyProcess.onExit((code) => this.dependencies.onProcessExit(code));

    const runtime = await proxyProcess.start(serverConfig);
    const ready = await this.dependencies.waitForReady(
      serverConfig.apiPort,
      serverConfig.apiToken,
      {
        getStderr: () => stderrLines.join('\n'),
        isProcessAlive: () => this.isProcessAlive(proxyProcess, runtime),
      }
    );
    if (!ready.success) {
      await this.dependencies.stopFailedProcess(proxyProcess, runtime);
      return { success: false, error: ready.error };
    }

    const sharedRuntime: SharedProxyRuntime = {
      process: proxyProcess,
      port: this.dependencies.port,
      apiPort: serverConfig.apiPort,
      userDataDir: this.dependencies.userDataDir,
      apiToken: serverConfig.apiToken,
    };
    this.dependencies.setRuntime(sharedRuntime);
    await this.persistState(
      caPath,
      serverConfig.apiPort,
      serverConfig.apiToken,
      runtime
    );
    this.dependencies.logStarted(
      `[Proxy:shared] Started MITM on 127.0.0.1:${this.dependencies.port}, ` +
        `API on 127.0.0.1:${serverConfig.apiPort} (pid ${runtime.pid})`
    );
    this.dependencies.appendStarted(this.dependencies.port);

    await this.prepareProfiles(profiles);
    await this.dependencies.ensureTrafficIngress(
      this.dependencies.port,
      serverConfig.apiPort,
      { forceRestart: true, apiToken: serverConfig.apiToken }
    );

    if (this.dependencies.shouldAutoShowOutput()) {
      this.dependencies.showOutput();
    }
    this.dependencies.notifyStatusChange();
    return { success: true, port: this.dependencies.port };
  }

  private async createServerConfig(
    profiles: Profile[],
    anchorProfile: Profile
  ): Promise<ProxyServerConfig> {
    const userIdToProfileId = await this.dependencies.buildUserIdMapping(
      profiles
    );
    const profileDbPaths = this.dependencies.buildProfileDbPaths(profiles);
    return this.dependencies.buildServerConfig(
      this.dependencies.port,
      anchorProfile,
      {
        profileId: this.dependencies.runtimeKey,
        userIdToProfileId: Object.fromEntries(userIdToProfileId),
        profileDbPaths,
      }
    );
  }

  private isProcessAlive(
    proxyProcess: IProxyProcess,
    runtime: ProxyProcessRuntime
  ): boolean {
    return runtime.pid != null && proxyProcess.isAlive(runtime.pid);
  }

  private async persistState(
    caPath: string,
    apiPort: number,
    apiToken: string | undefined,
    runtime: ProxyProcessRuntime
  ): Promise<void> {
    const timestamp = this.dependencies.now();
    const state: ProxyStateFile = {
      version: this.dependencies.stateSchemaVersion,
      profileId: this.dependencies.runtimeKey,
      running: true,
      port: this.dependencies.port,
      apiPort,
      apiToken,
      pid: runtime.pid,
      startedAt: timestamp,
      caCertificatePath: caPath,
      lastUpdatedAt: timestamp,
    };
    await this.dependencies.stateStore.write(state);
  }

  private async prepareProfiles(profiles: Profile[]): Promise<void> {
    for (const profile of profiles) {
      await this.dependencies.prepareProfile(profile, this.dependencies.port);
    }
  }
}
