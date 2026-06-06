import type { MultiplexerStatusView } from '@cursor-accounts/types';
import type {
  IMultiplexerManager,
  MultiplexerStartResult,
  MultiplexerStatus,
} from '../domain/ports/IMultiplexerManager';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import type { IMultiplexerFlowLogger } from '../application/types/multiplexerFlowLogger';
import type { MultiplexerConfig } from '../application/types/multiplexerConfig';
import type { MultiplexerMetricsView } from '../application/types/multiplexerMetrics';
import type { RoutingStrategyName } from '../domain/types/multiplexerTypes';
import type { SessionBinding } from '../domain/ports/ISessionStore';
import { MultiplexerRegistry } from '../application/services/multiplexerRegistry';

/**
 * Profile-scoped facade over the global MultiplexerRegistry for UI and commands.
 */
export class ProfileMultiplexerService implements IMultiplexerManager {
  constructor(
    private readonly registry: MultiplexerRegistry,
    private readonly profileDetector: IProfileDetector,
    private readonly profileManager?: IProfileManager,
    private readonly profileSettingsManager?: IProfileSettingsManager,
    private readonly flowLogger?: IMultiplexerFlowLogger
  ) {
    this.registry.onStatusChange(() => {
      for (const callback of this.statusCallbacks) {
        callback();
      }
    });
  }

  private readonly statusCallbacks: Array<() => void> = [];

  onStatusChange(callback: () => void): void {
    this.statusCallbacks.push(callback);
  }

  private async resolveProfileId(): Promise<string | null> {
    const profile = await this.profileDetector.detectCurrentProfile();
    return profile?.id ?? null;
  }

  async start(config?: Partial<MultiplexerConfig>): Promise<MultiplexerStartResult> {
    await this.registry.ensureStarted(config);
    return { success: true, port: 9000 };
  }

  async stop(): Promise<void> {
    const profileId = await this.resolveProfileId();
    if (!profileId) {
      return;
    }
    await this.registry.stopUpstreamsForProfile(profileId);

    if (this.profileManager && this.profileSettingsManager) {
      const profile = await this.profileManager.getProfile(profileId);
      if (profile) {
        await this.profileSettingsManager.restoreProxySettings(profile.userDataDir);
        this.flowLogger?.appendSettingsRestored(profile.userDataDir);
      }
    }
  }

  async restart(): Promise<MultiplexerStartResult> {
    await this.stop();
    return this.start();
  }

  async getStatus(): Promise<MultiplexerStatus> {
    const profileId = await this.resolveProfileId();
    const runtime = this.registry.getRuntime();
    const running = this.registry.isRunning();
    const metrics = runtime?.metricsAggregator.getView();
    const profileUpstreams = profileId
      ? this.registry.listUpstreamsForProfile(profileId)
      : [];

    return {
      running,
      port: running ? 9000 : undefined,
      strategy: runtime?.service.getConfig()?.routing.strategy,
      upstreamCount: profileUpstreams.length,
      activeSessions: metrics?.snapshot.activeSessions ?? 0,
    };
  }

  isRunning(): boolean {
    return this.registry.isRunning();
  }

  async isRunningForCurrentProfile(): Promise<boolean> {
    return this.registry.isRunning();
  }

  async getMetrics(): Promise<MultiplexerMetricsView | null> {
    return this.registry.getRuntime()?.metricsAggregator.getView() ?? null;
  }

  getSessions(): readonly SessionBinding[] {
    return this.registry.getRuntime()?.sessionStore.list() ?? [];
  }

  async getSessionsForCurrentProfile(): Promise<readonly SessionBinding[]> {
    return this.getSessions();
  }

  async getConfig(): Promise<MultiplexerConfig> {
    const config = this.registry.getRuntime()?.service.getConfig();
    if (!config) {
      throw new Error('Global multiplexer is not running');
    }
    return config;
  }

  async setStrategy(
    strategy: RoutingStrategyName
  ): Promise<MultiplexerStartResult> {
    await this.registry.stopAll();
    return this.start({
      routing: { strategy, fallbackStrategy: 'sticky-session' },
    });
  }

  getProxyServerUrl(): string | null {
    return this.registry.isRunning() ? this.registry.getProxyServerUrl() : null;
  }

  async getProxyServerUrlForCurrentProfile(): Promise<string | null> {
    return this.getProxyServerUrl();
  }

  async buildStatusView(): Promise<MultiplexerStatusView> {
    const profileId = await this.resolveProfileId();
    const runtime = this.registry.getRuntime();
    const running = this.registry.isRunning();
    const metrics = runtime?.metricsAggregator.getView();
    const config = runtime?.service.getConfig();
    const profileUpstreams = profileId
      ? this.registry.listUpstreamsForProfile(profileId)
      : [];

    const upstreams = profileUpstreams.map((upstream) => {
      const metric = metrics?.snapshot.upstreamMetrics[upstream.id];
      return {
        id: upstream.id,
        host: upstream.host,
        port: upstream.port,
        requests: metric?.requests ?? 0,
        activeConnections: upstream.connectionCount,
        healthy: upstream.healthy,
      };
    });

    return {
      running,
      port: running ? 9000 : config?.router.port,
      strategy: config?.routing.strategy,
      upstreamCount: upstreams.length,
      activeSessions: metrics?.snapshot.activeSessions ?? 0,
      upstreams,
      sessions: (runtime?.sessionStore.list() ?? []).map((session) => ({
        sessionKey: session.sessionKey,
        upstreamId: session.upstreamId,
        workspacePath: session.workspacePath,
        assignedAt: session.assignedAt.toISOString(),
      })),
    };
  }
}
