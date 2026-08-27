import type { IProxyControlClient } from '../../domain/ports/IProxyControlClient';
import type { ISharedProxyStateStore } from '../../domain/ports/ISharedProxyStateStore';
import type { SharedProxyRuntime } from './sharedProxyRuntimeStartUseCase';

export const SHARED_PROXY_STOP_GRACE_MS = 500;

export interface SharedProxyRuntimeStopUseCaseDependencies {
  stateStore: Pick<ISharedProxyStateStore, 'clear'>;
  getRuntime(): SharedProxyRuntime | undefined;
  createApiClient(
    apiPort: number,
    apiToken?: string
  ): Pick<IProxyControlClient, 'shutdown'>;
  wait(milliseconds: number): Promise<void>;
  stopRuntime(): Promise<void>;
  stopTrafficIngress(): void;
  notifyStatusChange(): void;
  logDebug(message: string): void;
}

/** Stops the shared runtime and clears its process-owned side effects. */
export class SharedProxyRuntimeStopUseCase {
  constructor(
    private readonly dependencies: SharedProxyRuntimeStopUseCaseDependencies
  ) {}

  async execute(): Promise<void> {
    const runtime = this.dependencies.getRuntime();
    if (!runtime) {
      return;
    }

    await shutdownApi(this.dependencies, runtime);
    await this.dependencies.stopRuntime();
    this.dependencies.stopTrafficIngress();
    await this.dependencies.stateStore.clear();
    this.dependencies.notifyStatusChange();
  }
}

async function shutdownApi(
  dependencies: SharedProxyRuntimeStopUseCaseDependencies,
  runtime: Pick<SharedProxyRuntime, 'apiPort' | 'apiToken'>
): Promise<void> {
  try {
    await dependencies
      .createApiClient(runtime.apiPort, runtime.apiToken)
      .shutdown();
    await dependencies.wait(SHARED_PROXY_STOP_GRACE_MS);
  } catch (error) {
    dependencies.logDebug(
      `[Proxy:shared] API shutdown failed: ${formatError(error)}`
    );
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
