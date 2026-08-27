import type { Profile } from '@cursor-accounts/types';
import type { IProfileReader } from '../../domain/ports/IProfileReader';
import type { IProxyControlClient } from '../../domain/ports/IProxyControlClient';
import type { IProxyStateStore } from '../../domain/ports/IProxyStateStore';
import type { IProxyTrafficIngress } from '../../domain/ports/IProxyTrafficIngress';

export const PROXY_STOP_GRACE_MS = 500;

export interface ProxyRuntimeHandle {
  apiPort?: number;
  apiToken?: string;
}

export interface ProxyProfileStopUseCaseDependencies {
  profileManager: IProfileReader;
  stateStore: IProxyStateStore;
  trafficIngress: IProxyTrafficIngress;
  getRuntime(profileId: string): ProxyRuntimeHandle | undefined;
  isSharedProxyActive(): boolean;
  createApiClient(
    apiPort: number,
    apiToken?: string
  ): Pick<IProxyControlClient, 'shutdown'>;
  resolveApiPort(mitmPort: number, persistedApiPort?: number): number;
  forceStopChild(profileId: string): Promise<void>;
  restoreProxySettings?(userDataDir: string): Promise<void>;
  wait(milliseconds: number): Promise<void>;
  logDebug(message: string): void;
  logError(message: string): void;
  logInfo(message: string): void;
  logWarn(message: string): void;
  appendStopped(): void;
  notifyStatusChange(): void;
}

/** Stops a profile runtime and restores the profile-owned side effects. */
export class ProxyProfileStopUseCase {
  constructor(
    private readonly dependencies: ProxyProfileStopUseCaseDependencies
  ) {}

  async execute(
    profileId: string,
    options?: { restoreSettings?: boolean }
  ): Promise<void> {
    const restoreSettings = options?.restoreSettings !== false;

    try {
      const profile = await this.dependencies.profileManager.getProfile(profileId);
      if (!profile) {
        return;
      }

      if (this.dependencies.isSharedProxyActive()) {
        if (restoreSettings) {
          await this.restoreSettingsSafely(profile, profileId);
        }
        return;
      }

      const runtime = this.dependencies.getRuntime(profileId);
      const state = await this.dependencies.stateStore.read(profile.userDataDir);
      const apiPort = this.resolveApiPort(runtime, state?.port, state?.apiPort);

      await this.shutdownApi(apiPort, state?.apiToken, profileId);
      await this.dependencies.forceStopChild(profileId);
      this.dependencies.trafficIngress.stop(profileId);

      if (restoreSettings) {
        await this.restoreSettingsSafely(profile, profileId);
      }

      await this.dependencies.stateStore.clear(profile.userDataDir);
      this.dependencies.logInfo(`[Proxy:${profileId}] Stopped`);
      this.dependencies.appendStopped();
      this.dependencies.notifyStatusChange();
    } catch (error) {
      this.dependencies.logError(
        `[Proxy] stop failed: ${formatError(error)}`
      );
    }
  }

  private resolveApiPort(
    runtime: ProxyRuntimeHandle | undefined,
    persistedMitmPort: number | undefined,
    persistedApiPort: number | undefined
  ): number | undefined {
    if (runtime?.apiPort != null) {
      return runtime.apiPort;
    }
    if (persistedMitmPort == null) {
      return undefined;
    }
    return this.dependencies.resolveApiPort(
      persistedMitmPort,
      persistedApiPort
    );
  }

  private async shutdownApi(
    apiPort: number | undefined,
    apiToken: string | undefined,
    profileId: string
  ): Promise<void> {
    if (apiPort == null) {
      return;
    }

    try {
      await this.dependencies.createApiClient(apiPort, apiToken).shutdown();
      await this.dependencies.wait(PROXY_STOP_GRACE_MS);
    } catch (error) {
      this.dependencies.logDebug(
        `[Proxy:${profileId}] API shutdown failed, falling back to process stop: ${formatError(error)}`
      );
    }
  }

  private async restoreSettingsSafely(
    profile: Profile,
    profileId: string
  ): Promise<void> {
    if (!this.dependencies.restoreProxySettings) {
      return;
    }

    try {
      await this.dependencies.restoreProxySettings(profile.userDataDir);
    } catch (error) {
      this.dependencies.logWarn(
        `[Proxy:${profileId}] Failed to restore profile settings: ${formatError(error)}`
      );
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
