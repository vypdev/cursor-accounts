import type {
  ProxyStateFile,
  ProxyStatus,
} from '@cursor-accounts/types';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { SharedProxyRuntime } from './sharedProxyLifecycleCoordinator';
import { SHARED_PROXY_RUNTIME_KEY } from '../proxy/types';

export interface ProxyTrafficTailerOptions {
  tailFromStart?: boolean;
  forceRestart?: boolean;
}

interface EnsureIngressOptions {
  forceRestart?: boolean;
  tailFromStart?: boolean;
  apiToken?: string;
}

export interface ProxyTrafficTailerCoordinatorDependencies {
  profileManager: IProfileReader;
  getRuntime(profileId: string): SharedProxyRuntime | undefined;
  runtimes(): Iterable<[string, SharedProxyRuntime]>;
  readSharedState(): Promise<ProxyStateFile | null>;
  getStatus(profileId: string): Promise<ProxyStatus | null>;
  isRunning(profileId: string): Promise<boolean>;
  resolveApiPort(mitmPort: number, persistedApiPort?: number): number;
  getApiToken(profileId: string): Promise<string | undefined>;
  ensureTrafficIngress(
    profileId: string,
    mitmPort: number,
    apiPort: number,
    options: EnsureIngressOptions
  ): Promise<void>;
}

/** Finds the active proxy endpoint and attaches traffic ingestion to it. */
export class ProxyTrafficTailerCoordinator {
  constructor(
    private readonly dependencies: ProxyTrafficTailerCoordinatorDependencies
  ) {}

  async ensureOutputTailer(
    profileId: string,
    options?: ProxyTrafficTailerOptions
  ): Promise<void> {
    const status = await this.dependencies.getStatus(profileId);
    if (!status?.running || status.port == null) {
      return;
    }

    const apiPort = this.dependencies.resolveApiPort(status.port, status.apiPort);
    await this.dependencies.ensureTrafficIngress(profileId, status.port, apiPort, {
      forceRestart: options?.forceRestart,
      tailFromStart: options?.tailFromStart,
      apiToken: await this.dependencies.getApiToken(profileId),
    });
  }

  async ensureTrafficTailer(): Promise<void> {
    const sharedRuntime = this.dependencies.getRuntime(SHARED_PROXY_RUNTIME_KEY);
    if (sharedRuntime) {
      await this.dependencies.ensureTrafficIngress(
        SHARED_PROXY_RUNTIME_KEY,
        sharedRuntime.port,
        sharedRuntime.apiPort,
        { forceRestart: false, apiToken: sharedRuntime.apiToken }
      );
      return;
    }

    const sharedState = await this.dependencies.readSharedState();
    if (sharedState?.running && sharedState.port != null) {
      const apiPort = this.dependencies.resolveApiPort(
        sharedState.port,
        sharedState.apiPort
      );
      await this.dependencies.ensureTrafficIngress(
        SHARED_PROXY_RUNTIME_KEY,
        sharedState.port,
        apiPort,
        { forceRestart: false, apiToken: sharedState.apiToken }
      );
      return;
    }

    for (const [profileId, runtime] of this.dependencies.runtimes()) {
      await this.dependencies.ensureTrafficIngress(
        profileId,
        runtime.port,
        runtime.apiPort,
        { forceRestart: false, apiToken: runtime.apiToken }
      );
      return;
    }

    const profiles = await this.dependencies.profileManager.getProfiles();
    for (const profile of profiles) {
      if (!(await this.dependencies.isRunning(profile.id))) {
        continue;
      }
      const status = await this.dependencies.getStatus(profile.id);
      if (status?.port != null) {
        const apiPort = this.dependencies.resolveApiPort(status.port, status.apiPort);
        await this.dependencies.ensureTrafficIngress(profile.id, status.port, apiPort, {
          forceRestart: false,
          apiToken: await this.dependencies.getApiToken(profile.id),
        });
        return;
      }
    }
  }
}
