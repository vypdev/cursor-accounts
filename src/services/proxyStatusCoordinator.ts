import {
  isProfileProxyEnabled,
  type ProxyStateFile,
  type ProxyStatus,
} from '@cursor-accounts/types';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import type { SharedProxyRuntime } from './sharedProxyLifecycleCoordinator';
import { SHARED_PROXY_RUNTIME_KEY } from '../proxy/types';

/** Dependencies required to build the observable proxy status read model. */
export interface ProxyStatusCoordinatorDependencies {
  profileManager: IProfileReader;
  stateStore: IProxyStateStore;
  logDirectory: string;
  getRuntime(profileId: string): SharedProxyRuntime | undefined;
  readSharedState(): Promise<ProxyStateFile | null>;
  resolveApiPort(mitmPort: number, persistedApiPort?: number): number;
  /** Returns null when the process implementation does not expose a child PID. */
  getRuntimePid(runtime: SharedProxyRuntime): number | null | undefined;
  isProcessAlive(pid: number): boolean;
  /** Returns true when the port is free, and therefore not listening. */
  isPortAvailable(port: number): Promise<boolean>;
}

/**
 * Reconciles persisted and in-memory proxy state into the status exposed to
 * commands and the webview. It also removes stale per-profile state when the
 * recorded process or listening port is no longer valid.
 */
export class ProxyStatusCoordinator {
  constructor(
    private readonly dependencies: ProxyStatusCoordinatorDependencies
  ) {}

  async getStatus(profileId: string): Promise<ProxyStatus | null> {
    const profile = await this.dependencies.profileManager.getProfile(profileId);
    if (!profile) {
      return this.stoppedStatus();
    }

    if (isProfileProxyEnabled(profile)) {
      const sharedRuntime = this.dependencies.getRuntime(SHARED_PROXY_RUNTIME_KEY);
      const sharedState = await this.dependencies.readSharedState();
      const port = sharedRuntime?.port ?? sharedState?.port;
      const apiPort =
        sharedRuntime?.apiPort ??
        (port != null
          ? this.dependencies.resolveApiPort(port, sharedState?.apiPort)
          : undefined);
      const runtimePid = sharedRuntime
        ? this.dependencies.getRuntimePid(sharedRuntime)
        : null;
      const pid =
        sharedRuntime && runtimePid !== null
          ? runtimePid
          : sharedState?.pid;

      if (port != null && (sharedRuntime || sharedState?.running)) {
        const alive = pid != null && this.dependencies.isProcessAlive(pid);
        if (alive) {
          return {
            running: true,
            port,
            apiPort,
            pid,
            startedAt: this.parseStartedAt(sharedState?.startedAt),
            caCertificatePath: sharedState?.caCertificatePath,
            logDirectory: this.dependencies.logDirectory,
          };
        }
      }
    }

    const state = await this.dependencies.stateStore.read(profile.userDataDir);
    const runtime = this.dependencies.getRuntime(profileId);

    if (!state) {
      if (runtime) {
        return {
          running: true,
          port: runtime.port,
          apiPort: runtime.apiPort,
          pid: this.dependencies.getRuntimePid(runtime) ?? undefined,
          logDirectory: this.dependencies.logDirectory,
        };
      }
      return this.stoppedStatus();
    }

    const alive = state.pid != null && this.dependencies.isProcessAlive(state.pid);
    if (!alive) {
      if (state.running) {
        await this.dependencies.stateStore.clear(profile.userDataDir);
      }
      return this.stoppedStatus(state.caCertificatePath);
    }

    const port = state.port;
    const portListening =
      port != null ? !(await this.dependencies.isPortAvailable(port)) : false;

    if (!portListening && state.running) {
      await this.dependencies.stateStore.clear(profile.userDataDir);
      return this.stoppedStatus(state.caCertificatePath);
    }

    return {
      running: true,
      port: state.port,
      apiPort:
        state.apiPort ??
        (port != null ? this.dependencies.resolveApiPort(port) : undefined),
      pid: state.pid,
      startedAt: this.parseStartedAt(state.startedAt),
      caCertificatePath: state.caCertificatePath,
      logDirectory: this.dependencies.logDirectory,
    };
  }

  private stoppedStatus(caCertificatePath?: string): ProxyStatus {
    const status: ProxyStatus = {
      running: false,
      logDirectory: this.dependencies.logDirectory,
    };
    if (caCertificatePath !== undefined) {
      status.caCertificatePath = caCertificatePath;
    }
    return status;
  }

  private parseStartedAt(startedAt?: string): number | undefined {
    return startedAt ? new Date(startedAt).getTime() : undefined;
  }
}
