import { isProfileProxyEnabled, type Profile, type ProxyStateFile } from '@cursor-accounts/types';
import type { IProfileReader } from '../../domain/ports/IProfileReader';
import type { IProxyStateStore } from '../../domain/ports/IProxyStateStore';
import type { ISharedProxyStateStore } from '../../domain/ports/ISharedProxyStateStore';

interface ProxyControlClient {
  getStatus(): Promise<{ running: boolean }>;
}

export interface ProxyProfileAttachUseCaseDependencies {
  profileManager: IProfileReader;
  stateStore: IProxyStateStore;
  sharedStateStore: ISharedProxyStateStore;
  sharedRuntimeId: string;
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
  warn(message: string): void;
  notifyStatusChange(): void;
}

/** Attaches a profile to a healthy persisted shared or profile proxy runtime. */
export class ProxyProfileAttachUseCase {
  constructor(
    private readonly dependencies: ProxyProfileAttachUseCaseDependencies
  ) {}

  async execute(profileId: string): Promise<void> {
    const profile = await this.dependencies.profileManager.getProfile(profileId);
    if (!profile || !isProfileProxyEnabled(profile)) {
      return;
    }

    const sharedState = await this.dependencies.sharedStateStore.read();
    if (sharedState?.running && sharedState.port != null) {
      const attached = await this.tryAttach(
        profile,
        this.dependencies.sharedRuntimeId,
        sharedState,
        true
      );
      if (attached) {
        return;
      }
    }

    const state = await this.dependencies.stateStore.read(profile.userDataDir);
    if (!state?.running || state.port == null) {
      return;
    }

    await this.tryAttach(profile, profileId, state, false);
  }

  private async tryAttach(
    profile: Profile,
    runtimeId: string,
    state: ProxyStateFile,
    shared: boolean
  ): Promise<boolean> {
    const port = state.port;
    if (port == null) {
      return false;
    }

    const apiPort = this.dependencies.resolveApiPort(
      port,
      state.apiPort
    );

    try {
      const status = await this.dependencies
        .createApiClient(apiPort, state.apiToken)
        .getStatus();

      if (!status.running) {
        if (!shared) {
          await this.dependencies.stateStore.clear(profile.userDataDir);
        }
        return false;
      }

      await this.initializeTracking(profile);
      await this.dependencies.applyProxySettings(profile.userDataDir, port);
      await this.dependencies.ensureTrafficIngress(
        runtimeId,
        port,
        apiPort,
        { forceRestart: true, apiToken: state.apiToken }
      );
      this.dependencies.notifyStatusChange();
      return true;
    } catch (error) {
      if (shared) {
        await this.dependencies.sharedStateStore.clear();
        return false;
      }

      this.dependencies.warn(
        `[Proxy:${profile.id}] Failed to attach to existing proxy API: ${formatError(error)}`
      );
      await this.dependencies.stateStore.clear(profile.userDataDir);
      this.dependencies.notifyStatusChange();
      return false;
    }
  }

  private async initializeTracking(profile: Profile): Promise<void> {
    try {
      await this.dependencies.ensureAgentTracking(
        profile.id,
        profile.userDataDir
      );
    } catch (error) {
      this.dependencies.warn(
        `[Proxy:${profile.id}] Agent tracking init failed during attach: ${formatError(error)}`
      );
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
