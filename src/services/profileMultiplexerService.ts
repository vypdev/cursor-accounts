import type { MultiplexerStatusView } from '@cursor-accounts/types';
import type {
  IMultiplexerManager,
  MultiplexerStartResult,
  MultiplexerStatus,
} from '../domain/ports/IMultiplexerManager';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import type { MultiplexerEventLogger } from '../proxy/multiplexer/multiplexerEventLogger';
import type { MultiplexerConfig } from '../application/types/multiplexerConfig';
import type { MultiplexerMetricsView } from '../application/types/multiplexerMetrics';
import type { SessionBinding } from '../domain/ports/ISessionStore';
import { MultiplexerRegistry } from '../application/services/multiplexerRegistry';
import {
  ManagementApiClient,
  mapStrategyName,
} from '../proxy/multiplexer/api/managementApiClient';
import * as extensionLog from '../logging/extensionLog';

/**
 * Profile-scoped facade over the global multiplexer for UI and commands.
 * All multiplexer state is queried through the management API.
 */
export class ProfileMultiplexerService implements IMultiplexerManager {
  private readonly apiClient: ManagementApiClient;

  constructor(
    private readonly registry: MultiplexerRegistry,
    private readonly profileDetector: IProfileDetector,
    private readonly profileManager?: IProfileManager,
    private readonly profileSettingsManager?: IProfileSettingsManager,
    private readonly eventLogger?: MultiplexerEventLogger
  ) {
    this.apiClient = new ManagementApiClient(registry.getProxyServerUrl());

    this.apiClient.connectWebSocket();
    this.apiClient.onNotification('status_changed', () => this.notifyStatusCallbacks());
    this.apiClient.onNotification('upstream_created', () => this.notifyStatusCallbacks());
    this.apiClient.onNotification('upstream_stopped', () => this.notifyStatusCallbacks());
    this.apiClient.onNotification('metrics_updated', () => this.notifyStatusCallbacks());
    this.apiClient.onNotification('config_changed', () => this.notifyStatusCallbacks());

    this.registry.onStatusChange(() => this.notifyStatusCallbacks());
  }

  private readonly statusCallbacks: Array<() => void> = [];

  onStatusChange(callback: () => void): void {
    this.statusCallbacks.push(callback);
  }

  private notifyStatusCallbacks(): void {
    for (const callback of this.statusCallbacks) {
      try {
        callback();
      } catch {
        // ignore listener errors
      }
    }
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

    if (this.registry.isRunning()) {
      try {
        await this.apiClient.deleteUpstreamsByProfile(profileId);
      } catch (error) {
        extensionLog.warn(
          `[ProfileMultiplexerService] Failed to stop upstreams via API: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    if (this.profileManager && this.profileSettingsManager) {
      const profile = await this.profileManager.getProfile(profileId);
      if (profile) {
        await this.profileSettingsManager.restoreProxySettings(profile.userDataDir);
        void this.eventLogger?.logSettingsRestored(profile.userDataDir);
      }
    }
  }

  async restart(): Promise<MultiplexerStartResult> {
    await this.stop();
    return this.start();
  }

  async getStatus(): Promise<MultiplexerStatus> {
    const running = this.registry.isRunning();
    if (!running) {
      return {
        running: false,
        activeSessions: 0,
      };
    }

    try {
      const statusResponse = await this.apiClient.getStatus();
      return {
        running: statusResponse.running,
        port: statusResponse.port,
        strategy: mapStrategyName(statusResponse.strategy),
        activeSessions: statusResponse.activeSessions,
      };
    } catch (error) {
      extensionLog.warn(
        `[ProfileMultiplexerService] Failed to get status via API: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return {
        running: true,
        port: 9000,
        activeSessions: 0,
      };
    }
  }

  isRunning(): boolean {
    return this.registry.isRunning();
  }

  async isRunningForCurrentProfile(): Promise<boolean> {
    return this.registry.isRunning();
  }

  async getMetrics(): Promise<MultiplexerMetricsView | null> {
    if (!this.registry.isRunning()) {
      return null;
    }

    try {
      const metricsResponse = await this.apiClient.getMetrics();
      return this.apiClient.toMetricsView(metricsResponse);
    } catch (error) {
      extensionLog.warn(
        `[ProfileMultiplexerService] Failed to get metrics via API: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      const cached = this.apiClient.getCachedMetrics();
      return cached ? this.apiClient.toMetricsView(cached) : null;
    }
  }

  getSessions(): readonly SessionBinding[] {
    return this.apiClient.getCachedSessions();
  }

  async getSessionsForCurrentProfile(): Promise<readonly SessionBinding[]> {
    if (!this.registry.isRunning()) {
      return [];
    }

    try {
      return await this.apiClient.getSessions();
    } catch {
      return this.apiClient.getCachedSessions();
    }
  }

  getProxyServerUrl(): string | null {
    return this.registry.isRunning() ? this.registry.getProxyServerUrl() : null;
  }

  async getProxyServerUrlForCurrentProfile(): Promise<string | null> {
    return this.getProxyServerUrl();
  }

  async buildStatusView(): Promise<MultiplexerStatusView> {
    const profileId = await this.resolveProfileId();
    const running = this.registry.isRunning();

    if (!running) {
      return {
        running: false,
        activeSessions: 0,
        upstreams: [],
      };
    }

    try {
      const [statusResponse, metricsResponse, profileUpstreamsDto] =
        await Promise.all([
          this.apiClient.getStatus(),
          this.apiClient.getMetrics(),
          profileId
            ? this.apiClient.getUpstreams(profileId)
            : Promise.resolve([]),
        ]);

      const upstreams = profileUpstreamsDto.map((upstream) => ({
        id: upstream.id,
        host: '127.0.0.1',
        port: 0,
        requests: metricsResponse.snapshot.upstreamMetrics[upstream.id]?.requests ?? upstream.trafficReceived,
        activeConnections: 0,
        healthy: upstream.healthy,
      }));

      return {
        running: statusResponse.running,
        port: statusResponse.port,
        strategy: mapStrategyName(statusResponse.strategy),
        activeSessions: statusResponse.activeSessions,
        upstreams,
      };
    } catch (error) {
      extensionLog.warn(
        `[ProfileMultiplexerService] Failed to build status view via API: ${
          error instanceof Error ? error.message : String(error)
        }`
      );

      const cachedStatus = this.apiClient.getCachedStatus();
      const cachedMetrics = this.apiClient.getCachedMetrics();
      const cachedUpstreams = profileId
        ? this.apiClient.getCachedUpstreams()
        : [];

      return {
        running: true,
        port: cachedStatus?.port ?? 9000,
        strategy: mapStrategyName(cachedStatus?.strategy ?? cachedMetrics?.strategy),
        activeSessions:
          cachedStatus?.activeSessions ??
          cachedMetrics?.snapshot.activeSessions ??
          0,
        upstreams: cachedUpstreams.map((upstream) => ({
          id: upstream.id,
          host: '127.0.0.1',
          port: 0,
          requests:
            cachedMetrics?.snapshot.upstreamMetrics[upstream.id]?.requests ??
            upstream.trafficReceived,
          activeConnections: 0,
          healthy: upstream.healthy,
        })),
      };
    }
  }

  dispose(): void {
    this.apiClient.disconnect();
  }
}
