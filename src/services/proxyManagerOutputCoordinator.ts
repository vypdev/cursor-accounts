import type {
  IProxyOutputPresenter,
  ITokenDetectorOutputPresenter,
  ProxyOutputSettings,
} from '../domain/ports/IProxyOutputPresenter';
import type { ProxyTrafficSummary } from '../domain/types/proxyTraffic';
import { clearProxyLogDirectory } from '../proxy/proxyLogCleanup';
import type { ProxyTrafficTailerOptions } from './proxyTrafficTailerCoordinator';

export interface ProxyManagerOutputCoordinatorDependencies {
  logDir: string;
  getOutputConfig(): ProxyOutputSettings;
  getRuntimeCount(): number;
  outputPresenter?: IProxyOutputPresenter;
  tokenDetectorPresenter?: ITokenDetectorOutputPresenter;
  ensureOutputTailer(
    profileId: string,
    options?: ProxyTrafficTailerOptions
  ): Promise<void>;
  ensureTrafficTailer(): Promise<void>;
}

/** Owns proxy output channels, traffic presentation, and log cleanup access. */
export class ProxyManagerOutputCoordinator {
  constructor(
    private readonly dependencies: ProxyManagerOutputCoordinatorDependencies
  ) {}

  getLogDirectory(): string {
    return this.dependencies.logDir;
  }

  async clearLogFiles(): Promise<{
    deletedFiles: number;
    deletedBytes: number;
  }> {
    if (this.dependencies.getRuntimeCount() > 0) {
      throw new Error('Stop the proxy before deleting its logs');
    }
    return clearProxyLogDirectory(this.dependencies.logDir);
  }

  showTokenDetectorChannel(): void {
    this.dependencies.tokenDetectorPresenter?.show();
  }

  ensureOutputTailer(
    profileId: string,
    options?: ProxyTrafficTailerOptions
  ): Promise<void> {
    return this.dependencies.ensureOutputTailer(profileId, options);
  }

  ensureTrafficTailer(): Promise<void> {
    return this.dependencies.ensureTrafficTailer();
  }

  showOutputChannel(): void {
    const settings = this.dependencies.getOutputConfig();
    this.dependencies.outputPresenter?.show();
    if (!settings.logTrafficToOutput) {
      this.dependencies.outputPresenter?.appendLogDisabled();
    }
  }

  presentTraffic(summary: ProxyTrafficSummary, profileId?: string): void {
    this.dependencies.tokenDetectorPresenter?.appendTraffic(summary, profileId);
    if (this.dependencies.getOutputConfig().logTrafficToOutput) {
      this.dependencies.outputPresenter?.appendTraffic(summary);
    }
  }
}
