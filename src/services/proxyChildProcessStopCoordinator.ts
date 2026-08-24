import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import type { SharedProxyRuntime } from './sharedProxyLifecycleCoordinator';

export interface ProxyChildProcessStopCoordinatorDependencies {
  getRuntime(profileId: string): SharedProxyRuntime | undefined;
  deleteRuntime(profileId: string): void;
  deleteAgentTracking(profileId: string): void;
  stateStore: IProxyStateStore;
  getChildPid(runtime: SharedProxyRuntime): number | undefined;
  detach(runtime: SharedProxyRuntime): void;
  gracePeriodMs: number;
  wait(milliseconds: number): Promise<void>;
}

/** Stops a managed child and clears local ownership regardless of exit path. */
export class ProxyChildProcessStopCoordinator {
  constructor(
    private readonly dependencies: ProxyChildProcessStopCoordinatorDependencies
  ) {}

  async stop(profileId: string): Promise<void> {
    const runtime = this.dependencies.getRuntime(profileId);
    this.dependencies.deleteRuntime(profileId);
    this.dependencies.deleteAgentTracking(profileId);

    if (!runtime) {
      return;
    }

    const pid =
      this.dependencies.getChildPid(runtime) ??
      (await this.dependencies.stateStore.read(runtime.userDataDir))?.pid;

    await runtime.process.stop(pid, 'SIGTERM');
    await this.dependencies.wait(this.dependencies.gracePeriodMs);
    if (pid != null && runtime.process.isAlive(pid)) {
      await runtime.process.stop(pid, 'SIGKILL');
    }
    this.dependencies.detach(runtime);
  }
}
