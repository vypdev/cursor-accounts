import * as crypto from 'node:crypto';
import type { IProfileManager } from '../../domain/ports/IProfileManager';
import type { IProxyManager } from '../../domain/ports/IProxyManager';
import type { MultiplexerConfig } from '../types/multiplexerConfig';
import type { IMultiplexerFlowLogger } from '../types/multiplexerFlowLogger';
import type { MultiplexerRuntime } from '../../proxy/multiplexer/factory';
import { createMultiplexerRuntime } from '../../proxy/multiplexer/factory';
import * as extensionLog from '../../logging/extensionLog';
import * as vscode from 'vscode';

const UPSTREAM_GC_INTERVAL_MS = 5 * 60 * 1000;
const UPSTREAM_IDLE_TTL_MS = 30 * 60 * 1000;
const GLOBAL_MULTIPLEXER_PORT = 9000;
const UPSTREAM_PORT_BASE = 8000;
const UPSTREAM_PORTS_PER_PROFILE = 100;

/**
 * Application service: single global multiplexer router shared by all profiles.
 */
export class MultiplexerRegistry implements vscode.Disposable {
  private globalRuntime: MultiplexerRuntime | null = null;
  private readonly upstreamActivity = new Map<string, Map<string, number>>();
  private readonly upstreamProfiles = new Map<string, string>();
  private gcInterval: ReturnType<typeof setInterval> | undefined;
  private readonly statusCallbacks: Array<() => void> = [];

  constructor(
    private readonly proxyManager: IProxyManager,
    private readonly profileManager: IProfileManager,
    private readonly flowLogger?: IMultiplexerFlowLogger
  ) {}

  dispose(): void {
    void this.stopAll();
  }

  onStatusChange(callback: () => void): void {
    this.statusCallbacks.push(callback);
  }

  getProxyServerUrl(): string {
    return `http://127.0.0.1:${GLOBAL_MULTIPLEXER_PORT}`;
  }

  isRunning(): boolean {
    return this.globalRuntime?.service.isRunning() === true;
  }

  getRuntime(): MultiplexerRuntime | undefined {
    return this.globalRuntime ?? undefined;
  }

  async ensureStarted(config?: Partial<MultiplexerConfig>): Promise<void> {
    if (this.globalRuntime?.service.isRunning()) {
      return;
    }

    const fullConfig: MultiplexerConfig = {
      router: { port: GLOBAL_MULTIPLEXER_PORT, host: '127.0.0.1' },
      upstreams: [],
      routing: {
        strategy: 'workspace-path',
        fallbackStrategy: 'sticky-session',
        sessionTimeoutMs: 3_600_000,
      },
      health: {
        checkIntervalMs: 30_000,
        timeoutMs: 5_000,
        unhealthyThreshold: 3,
      },
      ...config,
    };

    const runtime = createMultiplexerRuntime(fullConfig, {
      profileManager: this.profileManager,
      flowLogger: this.flowLogger,
      onUpstreamCreate: (profileId, workspacePath) =>
        this.createUpstreamForWorkspace(profileId, workspacePath),
      onUpstreamActivity: (upstreamId) =>
        this.recordUpstreamActivityForUpstream(upstreamId),
    });

    await runtime.service.start(fullConfig);
    this.globalRuntime = runtime;
    this.startGc();

    this.flowLogger?.appendMultiplexerStarted(GLOBAL_MULTIPLEXER_PORT);
    extensionLog.info(
      `[Multiplexer] Global multiplexer started on 127.0.0.1:${GLOBAL_MULTIPLEXER_PORT}`
    );
    this.notifyStatusChange();
  }

  async stopUpstreamsForProfile(profileId: string): Promise<void> {
    const runtime = this.globalRuntime;
    if (!runtime) {
      return;
    }

    const upstreams = runtime.upstreamPool.listByMetadata({ profileId });
    for (const upstream of upstreams) {
      await runtime.upstreamPool.removeUpstream(upstream.id);
      await this.proxyManager.stopUpstream(upstream.id);
      this.upstreamProfiles.delete(upstream.id);
      this.flowLogger?.appendUpstreamStopped(upstream.id);
    }

    this.upstreamActivity.delete(profileId);
    this.notifyStatusChange();

    extensionLog.info(
      `[Multiplexer] Stopped upstreams for profile=${profileId}`
    );
  }

  async stopAll(): Promise<void> {
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = undefined;
    }

    if (this.globalRuntime) {
      const upstreams = this.globalRuntime.upstreamPool.getAll();
      for (const upstream of upstreams) {
        await this.proxyManager.stopUpstream(upstream.id);
        this.upstreamProfiles.delete(upstream.id);
        this.flowLogger?.appendUpstreamStopped(upstream.id);
      }

      await this.globalRuntime.service.stop();
      this.globalRuntime = null;
      this.flowLogger?.appendMultiplexerStopped();
      extensionLog.info('[Multiplexer] Global multiplexer stopped');
    }

    this.upstreamActivity.clear();
    this.notifyStatusChange();
  }

  async createUpstreamForWorkspace(
    profileId: string,
    workspacePath: string
  ): Promise<string> {
    if (!this.globalRuntime) {
      throw new Error('Global multiplexer is not running');
    }

    const existing = this.globalRuntime.upstreamPool.getByWorkspace(
      workspacePath,
      profileId
    );
    if (existing) {
      return existing.id;
    }

    const upstreamId = `${profileId}-${this.hashWorkspace(workspacePath)}`;
    const preferredPort = await this.allocateUpstreamPort(profileId);

    const result = await this.proxyManager.startUpstream(upstreamId, {
      profileId,
      workspacePath,
      preferredPort,
    });

    if (!result.success) {
      throw new Error(`Failed to start upstream: ${result.error ?? 'unknown'}`);
    }

    const port = result.port ?? preferredPort;
    await this.globalRuntime.upstreamPool.createUpstream({
      id: upstreamId,
      host: '127.0.0.1',
      port,
      weight: 1,
      maxConnections: 100,
      metadata: { workspacePath, profileId },
    });
    this.upstreamProfiles.set(upstreamId, profileId);

    this.flowLogger?.appendUpstreamCreated(
      upstreamId,
      profileId,
      workspacePath,
      port
    );
    extensionLog.info(
      `[Multiplexer] Created upstream ${upstreamId} profile=${profileId} workspace=${workspacePath}`
    );
    return upstreamId;
  }

  recordUpstreamActivity(profileId: string, upstreamId: string): void {
    let activity = this.upstreamActivity.get(profileId);
    if (!activity) {
      activity = new Map();
      this.upstreamActivity.set(profileId, activity);
    }
    activity.set(upstreamId, Date.now());
  }

  listUpstreamsForProfile(profileId: string) {
    return (
      this.globalRuntime?.upstreamPool.listByMetadata({ profileId }) ?? []
    );
  }

  private recordUpstreamActivityForUpstream(upstreamId: string): void {
    const profileId = this.upstreamProfiles.get(upstreamId);
    if (profileId) {
      this.recordUpstreamActivity(profileId, upstreamId);
    }
  }

  private async allocateUpstreamPort(profileId: string): Promise<number> {
    const profiles = await this.profileManager.getProfiles();
    const profileIndex = profiles.findIndex((profile) => profile.id === profileId);
    const basePort =
      UPSTREAM_PORT_BASE +
      Math.max(0, profileIndex) * UPSTREAM_PORTS_PER_PROFILE;
    const usedPorts = new Set(
      this.globalRuntime?.upstreamPool.getAll().map((upstream) => upstream.port) ??
        []
    );

    for (
      let port = basePort;
      port < basePort + UPSTREAM_PORTS_PER_PROFILE;
      port++
    ) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }

    throw new Error(`No available upstream ports for profile ${profileId}`);
  }

  private hashWorkspace(path: string): string {
    return crypto.createHash('sha256').update(path).digest('hex').slice(0, 8);
  }

  private startGc(): void {
    if (this.gcInterval) {
      return;
    }

    this.gcInterval = setInterval(() => {
      void this.cleanupIdleUpstreams();
    }, UPSTREAM_GC_INTERVAL_MS);
  }

  private async cleanupIdleUpstreams(): Promise<void> {
    const runtime = this.globalRuntime;
    if (!runtime) {
      return;
    }

    const now = Date.now();

    for (const upstream of runtime.upstreamPool.getAll()) {
      const profileId = this.upstreamProfiles.get(upstream.id);
      const activity = profileId
        ? (this.upstreamActivity.get(profileId) ?? new Map())
        : new Map<string, number>();
      const lastActivity = activity.get(upstream.id) ?? 0;

      if (
        now - lastActivity > UPSTREAM_IDLE_TTL_MS &&
        upstream.connectionCount === 0
      ) {
        extensionLog.info(
          `[Multiplexer] GC removing idle upstream ${upstream.id}`
        );
        await runtime.upstreamPool.removeUpstream(upstream.id);
        await this.proxyManager.stopUpstream(upstream.id);
        this.upstreamProfiles.delete(upstream.id);
        activity.delete(upstream.id);
        this.flowLogger?.appendUpstreamStopped(upstream.id);
      }
    }
  }

  private notifyStatusChange(): void {
    for (const callback of this.statusCallbacks) {
      try {
        callback();
      } catch {
        // ignore listener errors
      }
    }
  }
}
