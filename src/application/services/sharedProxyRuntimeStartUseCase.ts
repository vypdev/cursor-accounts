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
    return executeRuntimeStart(this.dependencies, profiles);
  }
}

async function executeRuntimeStart(
  dependencies: SharedProxyRuntimeStartUseCaseDependencies,
  profiles: Profile[]
): Promise<ProxyStartResult> {
  await dependencies.ensureStorageDirectories();
  const caPath = await dependencies.ensureCaCertificate();
  const anchorProfile = profiles[0]!;
  const serverConfig = await createServerConfig(
    dependencies,
    profiles,
    anchorProfile
  );
  const proxyProcess = dependencies.createProcess();
  const stderrLines: string[] = [];

  proxyProcess.onStderr((line) => {
    stderrLines.push(line);
    dependencies.onStderrLine(line);
  });
  proxyProcess.onExit((code) => dependencies.onProcessExit(code));

  const runtime = await proxyProcess.start(serverConfig);
  const ready = await dependencies.waitForReady(
    serverConfig.apiPort,
    serverConfig.apiToken,
    {
      getStderr: () => stderrLines.join('\n'),
      isProcessAlive: () => isProcessAlive(proxyProcess, runtime),
    }
  );
  if (!ready.success) {
    await dependencies.stopFailedProcess(proxyProcess, runtime);
    return { success: false, error: ready.error };
  }

  const sharedRuntime: SharedProxyRuntime = {
    process: proxyProcess,
    port: dependencies.port,
    apiPort: serverConfig.apiPort,
    userDataDir: dependencies.userDataDir,
    apiToken: serverConfig.apiToken,
  };
  dependencies.setRuntime(sharedRuntime);
  await persistState(
    dependencies,
    caPath,
    serverConfig.apiPort,
    serverConfig.apiToken,
    runtime
  );
  dependencies.logStarted(
    `[Proxy:shared] Started MITM on 127.0.0.1:${dependencies.port}, ` +
      `API on 127.0.0.1:${serverConfig.apiPort} (pid ${runtime.pid})`
  );
  dependencies.appendStarted(dependencies.port);

  await prepareProfiles(dependencies, profiles);
  await dependencies.ensureTrafficIngress(
    dependencies.port,
    serverConfig.apiPort,
    { forceRestart: true, apiToken: serverConfig.apiToken }
  );

  if (dependencies.shouldAutoShowOutput()) {
    dependencies.showOutput();
  }
  dependencies.notifyStatusChange();
  return { success: true, port: dependencies.port };
}

async function createServerConfig(
  dependencies: SharedProxyRuntimeStartUseCaseDependencies,
  profiles: Profile[],
  anchorProfile: Profile
): Promise<ProxyServerConfig> {
  const userIdToProfileId = await dependencies.buildUserIdMapping(profiles);
  const profileDbPaths = dependencies.buildProfileDbPaths(profiles);
  return dependencies.buildServerConfig(dependencies.port, anchorProfile, {
    profileId: dependencies.runtimeKey,
    userIdToProfileId: Object.fromEntries(userIdToProfileId),
    profileDbPaths,
  });
}

function isProcessAlive(
  proxyProcess: IProxyProcess,
  runtime: ProxyProcessRuntime
): boolean {
  return runtime.pid != null && proxyProcess.isAlive(runtime.pid);
}

async function persistState(
  dependencies: SharedProxyRuntimeStartUseCaseDependencies,
  caPath: string,
  apiPort: number,
  apiToken: string | undefined,
  runtime: ProxyProcessRuntime
): Promise<void> {
  const timestamp = dependencies.now();
  const state: ProxyStateFile = {
    version: dependencies.stateSchemaVersion,
    profileId: dependencies.runtimeKey,
    running: true,
    port: dependencies.port,
    apiPort,
    apiToken,
    pid: runtime.pid,
    startedAt: timestamp,
    caCertificatePath: caPath,
    lastUpdatedAt: timestamp,
  };
  await dependencies.stateStore.write(state);
}

async function prepareProfiles(
  dependencies: SharedProxyRuntimeStartUseCaseDependencies,
  profiles: Profile[]
): Promise<void> {
  for (const profile of profiles) {
    await dependencies.prepareProfile(profile, dependencies.port);
  }
}
