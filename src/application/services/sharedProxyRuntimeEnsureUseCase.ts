import { isProfileProxyEnabled, type Profile, type ProxyStateFile } from '@cursor-accounts/types';
import type { IProxyControlClient } from '../../domain/ports/IProxyControlClient';
import type { ProxyStartResult } from '../../domain/ports/IProxyManager';
import type { ISharedProxyStateStore } from '../../domain/ports/ISharedProxyStateStore';
import type { SharedProxyRuntime } from './sharedProxyRuntimeStartUseCase';

export interface SharedProxyRuntimeEnsureUseCaseDependencies {
  sharedProxyPort: number;
  stateStore: Pick<ISharedProxyStateStore, 'read' | 'clear'>;
  getRuntime(): SharedProxyRuntime | undefined;
  resolveApiPort(mitmPort: number, persistedApiPort?: number): number;
  createApiClient(
    apiPort: number,
    apiToken?: string
  ): Pick<IProxyControlClient, 'getStatus'>;
  isPortAvailable(port: number): Promise<boolean>;
  prepareProfile(profile: Profile, port: number): Promise<void>;
  ensureTrafficIngress(
    port: number,
    apiPort: number,
    options: { forceRestart: boolean; apiToken?: string }
  ): Promise<void>;
  startRuntime(profiles: Profile[]): Promise<ProxyStartResult>;
  notifyStatusChange(): void;
}

/** Reuses, attaches, or starts the shared proxy runtime for enabled profiles. */
export class SharedProxyRuntimeEnsureUseCase {
  constructor(
    private readonly dependencies: SharedProxyRuntimeEnsureUseCaseDependencies
  ) {}

  async execute(profiles: Profile[]): Promise<ProxyStartResult> {
    const enabledProfiles = profiles.filter(isProfileProxyEnabled);
    if (enabledProfiles.length === 0) {
      return { success: false, error: 'No profiles with proxy enabled' };
    }

    const runtime = this.dependencies.getRuntime();
    if (runtime) {
      await configureRuntime(this.dependencies, enabledProfiles, runtime);
      return { success: true, port: runtime.port };
    }

    const state = await this.dependencies.stateStore.read();
    const attached = await attachPersistedRuntime(
      this.dependencies,
      enabledProfiles,
      state
    );
    if (attached) {
      return attached;
    }

    return startAvailableRuntime(this.dependencies, enabledProfiles);
  }
}

async function configureRuntime(
  dependencies: SharedProxyRuntimeEnsureUseCaseDependencies,
  profiles: Profile[],
  runtime: Pick<SharedProxyRuntime, 'port' | 'apiPort' | 'apiToken'>
): Promise<void> {
  for (const profile of profiles) {
    await dependencies.prepareProfile(profile, runtime.port);
    await dependencies.ensureTrafficIngress(runtime.port, runtime.apiPort, {
      forceRestart: false,
      apiToken: runtime.apiToken,
    });
  }
}

async function attachPersistedRuntime(
  dependencies: SharedProxyRuntimeEnsureUseCaseDependencies,
  profiles: Profile[],
  state: ProxyStateFile | null
): Promise<ProxyStartResult | undefined> {
  if (!state?.running || state.port == null) {
    return undefined;
  }

  const apiPort = dependencies.resolveApiPort(state.port, state.apiPort);
  try {
    const status = await dependencies
      .createApiClient(apiPort, state.apiToken)
      .getStatus();
    if (!status.running) {
      return undefined;
    }

    await prepareProfiles(dependencies, profiles, state.port);
    await dependencies.ensureTrafficIngress(state.port, apiPort, {
      forceRestart: true,
      apiToken: state.apiToken,
    });
    dependencies.notifyStatusChange();
    return { success: true, port: state.port };
  } catch {
    await dependencies.stateStore.clear();
    return undefined;
  }
}

async function prepareProfiles(
  dependencies: SharedProxyRuntimeEnsureUseCaseDependencies,
  profiles: Profile[],
  port: number
): Promise<void> {
  for (const profile of profiles) {
    await dependencies.prepareProfile(profile, port);
  }
}

async function startAvailableRuntime(
  dependencies: SharedProxyRuntimeEnsureUseCaseDependencies,
  profiles: Profile[]
): Promise<ProxyStartResult> {
  const available = await dependencies.isPortAvailable(
    dependencies.sharedProxyPort
  );
  if (!available) {
    return {
      success: false,
      error: `Shared proxy port ${dependencies.sharedProxyPort} is not available`,
    };
  }

  return dependencies.startRuntime(profiles);
}
