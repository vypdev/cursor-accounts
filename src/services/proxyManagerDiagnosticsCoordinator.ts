import type { ProxyTrafficDiagnostics } from '@cursor-accounts/types';
import type { IProxyOutputPresenter } from '../domain/ports/IProxyOutputPresenter';
import { formatDiagnosticsSummaryLines } from '../proxy/proxyTrafficDiagnostics';

export interface ProxyManagerDiagnosticsSettings {
  enabled: boolean;
  intervalMs: number;
}

export interface ProxyManagerDiagnosticsCoordinatorDependencies {
  getSettings(): ProxyManagerDiagnosticsSettings;
  outputPresenter?: IProxyOutputPresenter;
  now?: () => number;
}

/** Applies output settings and throttling to child-proxy diagnostics. */
export class ProxyManagerDiagnosticsCoordinator {
  private readonly now: () => number;
  private lastOutputAt = 0;

  constructor(
    private readonly dependencies: ProxyManagerDiagnosticsCoordinatorDependencies
  ) {
    this.now = dependencies.now ?? Date.now;
  }

  maybeEmit(diagnostics: ProxyTrafficDiagnostics | undefined): void {
    if (!diagnostics) {
      return;
    }

    const settings = this.dependencies.getSettings();
    if (!settings.enabled) {
      return;
    }

    const now = this.now();
    if (now - this.lastOutputAt < settings.intervalMs - 2_000) {
      return;
    }
    this.lastOutputAt = now;

    this.dependencies.outputPresenter?.appendDiagnostics(
      formatDiagnosticsSummaryLines(diagnostics)
    );
  }
}
