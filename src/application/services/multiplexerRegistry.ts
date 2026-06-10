import type { IProfileManager } from '../../domain/ports/IProfileManager';
import type { MultiplexerConfig } from '../types/multiplexerConfig';
import { buildMultiplexerConfig, GLOBAL_MULTIPLEXER_PORT } from '../types/multiplexerConfig';
import type { MultiplexerEventLogger } from '../../proxy/multiplexer/multiplexerEventLogger';
import type { MultiplexerRuntime } from '../../proxy/multiplexer/factory';
import { createMultiplexerRuntime } from '../../proxy/multiplexer/factory';
import { ManagementApiClient } from '../../proxy/multiplexer/api/managementApiClient';
import * as extensionLog from '../../logging/extensionLog';
import * as vscode from 'vscode';

const UPSTREAM_GC_INTERVAL_MS = 5 * 60 * 1000;
const UPSTREAM_IDLE_TTL_MS = 30 * 60 * 1000;

/**
 * Application service: launches the global multiplexer MITM process (lifecycle only).
 * All status/metrics queries go through the management API client.
 */
export class MultiplexerRegistry implements vscode.Disposable {
  private globalRuntime: MultiplexerRuntime | null = null;
  private readonly apiClient: ManagementApiClient;
  private readonly upstreamActivity = new Map<string, Map<string, number>>();
  private gcInterval: ReturnType<typeof setInterval> | undefined;
  private readonly statusCallbacks: Array<() => void> = [];
  private multiplexerStarted = false;
  private externalMultiplexerDetected = false;
  private readonly port: number;

  constructor(
    private readonly profileManager: IProfileManager,
    private readonly storageDir: string,
    private readonly extensionPath: string,
    private readonly eventLogger?: MultiplexerEventLogger,
    port?: number
  ) {
    this.port = port ?? GLOBAL_MULTIPLEXER_PORT;
    this.apiClient = new ManagementApiClient(
      `http://127.0.0.1:${this.port}`
    );
  }

  dispose(): void {
    this.apiClient.disconnect();
    void this.stopAll();
  }

  onStatusChange(callback: () => void): void {
    this.statusCallbacks.push(callback);
  }

  getProxyServerUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  isRunning(): boolean {
    return (
      this.multiplexerStarted ||
      this.externalMultiplexerDetected ||
      this.globalRuntime?.service.isRunning() === true
    );
  }

  async ensureStarted(config?: Partial<MultiplexerConfig>): Promise<void> {
    if (this.multiplexerStarted || this.globalRuntime?.service.isRunning()) {
      return;
    }

    const fullConfig = buildMultiplexerConfig(config);

    const runtime = createMultiplexerRuntime(fullConfig, {
      profileManager: this.profileManager,
      eventLogger: this.eventLogger,
      storageDir: this.storageDir,
      extensionPath: this.extensionPath,
      testMode: process.env.NODE_ENV === 'test',
    });

    try {
      await runtime.service.start(fullConfig);
      this.globalRuntime = runtime;
      this.multiplexerStarted = true;
      this.startGc();

      void this.eventLogger?.logMultiplexerStarted(
        GLOBAL_MULTIPLEXER_PORT,
        fullConfig.routing.strategy
      );
      extensionLog.info(
        `[Multiplexer] Global multiplexer started on 127.0.0.1:${GLOBAL_MULTIPLEXER_PORT}`
      );
      this.notifyStatusChange();
    } catch (error) {
      const isAddressInUse =
        error instanceof Error &&
        'code' in error &&
        error.code === 'EADDRINUSE';

      if (isAddressInUse) {
        extensionLog.warn(
          `[Multiplexer] Port ${GLOBAL_MULTIPLEXER_PORT} already in use (another Cursor window is running the multiplexer). This window will use the shared multiplexer.`
        );
        this.externalMultiplexerDetected = true;
        this.notifyStatusChange();
        return;
      }

      extensionLog.error(
        `[Multiplexer] Failed to start: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  async createUpstreamWorker(
    profileId: string,
    workspacePath: string,
    userDataDir?: string
  ): Promise<string> {
    if (!this.isRunning()) {
      throw new Error('Global multiplexer is not running');
    }

    const resolvedUserDataDir =
      userDataDir && userDataDir.length > 0
        ? userDataDir
        : (await this.profileManager.getProfile(profileId))?.userDataDir;

    if (!resolvedUserDataDir) {
      throw new Error(`Profile ${profileId} not found`);
    }

    // Check if upstream already exists via API
    const existing = await this.apiClient.getUpstreams(profileId);
    const found = existing.find(
      (u) => u.metadata?.workspacePath === workspacePath
    );
    if (found) {
      this.recordUpstreamActivity(profileId, found.id);
      return found.id;
    }

    // Create upstream via Management API
    const result = await this.apiClient.createUpstream(
      profileId,
      workspacePath,
      resolvedUserDataDir
    );

    this.recordUpstreamActivity(profileId, result.upstreamId);

    extensionLog.info(
      `[Multiplexer] Created upstream worker ${result.upstreamId} profile=${profileId} workspace=${workspacePath}`
    );
    return result.upstreamId;
  }

  async stopUpstreamWorkersForProfile(profileId: string): Promise<void> {
    if (!this.isRunning()) {
      return;
    }

    try {
      await this.apiClient.deleteUpstreamsByProfile(profileId);
      this.upstreamActivity.delete(profileId);
      this.notifyStatusChange();

      extensionLog.info(
        `[Multiplexer] Stopped upstream workers for profile=${profileId}`
      );
    } catch (error) {
      extensionLog.error(
        `[Multiplexer] Failed to stop upstreams for profile=${profileId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async stopAll(): Promise<void> {
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = undefined;
    }

    if (this.globalRuntime) {
      await this.globalRuntime.service.stop();
      this.globalRuntime = null;
      this.multiplexerStarted = false;
      void this.eventLogger?.logMultiplexerStopped();
      extensionLog.info('[Multiplexer] Global multiplexer stopped');
    }

    this.upstreamActivity.clear();
    this.externalMultiplexerDetected = false;
    this.notifyStatusChange();
  }

  private async deleteUpstreamWorker(
    upstreamId: string,
    _reason?: string
  ): Promise<void> {
    if (!this.isRunning()) {
      return;
    }

    try {
      await this.apiClient.deleteUpstream(upstreamId);
    } catch (error) {
      extensionLog.error(
        `[Multiplexer] Failed to delete upstream ${upstreamId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private recordUpstreamActivity(profileId: string, upstreamId: string): void {
    let activity = this.upstreamActivity.get(profileId);
    if (!activity) {
      activity = new Map();
      this.upstreamActivity.set(profileId, activity);
    }
    activity.set(upstreamId, Date.now());
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
    if (!this.isRunning()) {
      return;
    }

    try {
      const allUpstreams = await this.apiClient.getUpstreams();
      const now = Date.now();

      for (const worker of allUpstreams) {
        const activity = this.upstreamActivity.get(worker.metadata?.profileId ?? '') ?? new Map();
        const lastActivity = activity.get(worker.id) ?? 0;

        if (
          now - lastActivity > UPSTREAM_IDLE_TTL_MS &&
          worker.trafficReceived === 0
        ) {
          extensionLog.info(
            `[Multiplexer] GC removing idle upstream worker ${worker.id}`
          );
          await this.deleteUpstreamWorker(worker.id, 'idle-gc');
          activity.delete(worker.id);
        }
      }
    } catch (error) {
      extensionLog.error(
        `[Multiplexer] Failed to cleanup idle upstreams: ${error instanceof Error ? error.message : String(error)}`
      );
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
