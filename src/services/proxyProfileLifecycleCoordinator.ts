import {
  isProfileProxyEnabled,
  type Profile,
} from '@cursor-accounts/types';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import type { IProxyTrafficIngress } from '../domain/ports/IProxyTrafficIngress';
import type { SharedProxyRuntime } from './sharedProxyLifecycleCoordinator';
import type { ISharedProxyStateStore } from '../domain/ports/ISharedProxyStateStore';
import { SHARED_PROXY_RUNTIME_KEY } from '../proxy/types';
import * as extensionLog from '../logging/extensionLog';

export const PROXY_STOP_GRACE_MS = 500;

interface ProxyControlClient {
  getStatus(): Promise<{ running: boolean }>;
  shutdown(): Promise<void>;
}

export interface ProxyProfileLifecycleCoordinatorDependencies {
  profileManager: IProfileReader;
  stateStore: IProxyStateStore;
  sharedStateStore: ISharedProxyStateStore;
  trafficIngress: IProxyTrafficIngress;
  getRuntime(profileId: string): SharedProxyRuntime | undefined;
  isSharedProxyActive(): boolean;
  createApiClient(apiPort: number, apiToken?: string): ProxyControlClient;
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
  constructor(
    private readonly dependencies: ProxyProfileLifecycleCoordinatorDependencies
  ) {}

  async connectToExistingProxy(profileId: string): Promise<void> {
    const profile = await this.dependencies.profileManager.getProfile(profileId);
    if (!profile || !isProfileProxyEnabled(profile)) {
      return;
    }

    const sharedState = await this.dependencies.sharedStateStore.read();
    if (sharedState?.running && sharedState.port != null) {
      const apiPort = this.dependencies.resolveApiPort(
        sharedState.port,
        sharedState.apiPort
      );
      try {
        const status = await this.dependencies
          .createApiClient(apiPort, sharedState.apiToken)
          .getStatus();
        if (status.running) {
          await this.initializeTrackingForAttach(profile);
          await this.dependencies.applyProxySettings(
            profile.userDataDir,
            sharedState.port
          );
          await this.dependencies.ensureTrafficIngress(
            SHARED_PROXY_RUNTIME_KEY,
            sharedState.port,
            apiPort,
            { forceRestart: true, apiToken: sharedState.apiToken }
          );
          this.dependencies.notifyStatusChange();
          return;
        }
      } catch {
        await this.dependencies.sharedStateStore.clear();
      }
    }

    const state = await this.dependencies.stateStore.read(profile.userDataDir);
    if (!state?.running || state.port == null) {
      return;
    }

    const apiPort = this.dependencies.resolveApiPort(state.port, state.apiPort);
    try {
      const status = await this.dependencies
        .createApiClient(apiPort, state.apiToken)
        .getStatus();
      if (!status.running) {
        await this.dependencies.stateStore.clear(profile.userDataDir);
        return;
      }

      await this.initializeTrackingForAttach(profile);
      await this.dependencies.applyProxySettings(profile.userDataDir, state.port);
      await this.dependencies.ensureTrafficIngress(
        profileId,
        state.port,
        apiPort,
        { forceRestart: true, apiToken: state.apiToken }
      );
      this.dependencies.notifyStatusChange();
    } catch (error) {
      extensionLog.warn(
        `[Proxy:${profileId}] Failed to attach to existing proxy API: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      await this.dependencies.stateStore.clear(profile.userDataDir);
      this.dependencies.notifyStatusChange();
    }
  }

  async stop(
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
          await this.restoreSettingsSafely(profile.userDataDir, profileId);
        }
        return;
      }

      const runtime = this.dependencies.getRuntime(profileId);
      const state = await this.dependencies.stateStore.read(profile.userDataDir);
      const apiPort =
        runtime?.apiPort ??
        (state?.port != null
          ? this.dependencies.resolveApiPort(state.port, state.apiPort)
          : undefined);

      if (apiPort != null) {
        try {
          await this.dependencies.createApiClient(apiPort, state?.apiToken).shutdown();
          await new Promise((resolve) => setTimeout(resolve, PROXY_STOP_GRACE_MS));
        } catch (error) {
          extensionLog.debug(
            `[Proxy:${profileId}] API shutdown failed, falling back to process stop: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      await this.dependencies.forceStopChild(profileId);
      this.dependencies.trafficIngress.stop(profileId);

      if (restoreSettings) {
        await this.restoreSettingsSafely(profile.userDataDir, profileId);
      }

      await this.dependencies.stateStore.clear(profile.userDataDir);
      extensionLog.info(`[Proxy:${profileId}] Stopped`);
      this.dependencies.appendStopped();
      this.dependencies.notifyStatusChange();
    } catch (error) {
      extensionLog.error(
        `[Proxy] stop failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async initializeTrackingForAttach(profile: Profile): Promise<void> {
    try {
      await this.dependencies.ensureAgentTracking(
        profile.id,
        profile.userDataDir
      );
    } catch (error) {
      extensionLog.warn(
        `[Proxy:${profile.id}] Agent tracking init failed during attach: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async restoreSettingsSafely(
    userDataDir: string,
    profileId: string
  ): Promise<void> {
    if (!this.dependencies.restoreProxySettings) {
      return;
    }
    try {
      await this.dependencies.restoreProxySettings(userDataDir);
    } catch (error) {
      extensionLog.warn(
        `[Proxy:${profileId}] Failed to restore profile settings: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
