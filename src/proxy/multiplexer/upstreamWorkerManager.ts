import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import type { IProfileManager } from '../../domain/ports/IProfileManager';
import type { IUpstreamWorkerRegistry } from '../../domain/ports/IUpstreamWorkerRegistry';
import type { ProxyTrafficSummary } from '../../application/types/proxyTraffic';
import type { MultiplexerEventLogger } from './multiplexerEventLogger';
import { UpstreamWorkerProcess } from './upstreamWorkerProcess';
import type { UpstreamWorkerRecord } from './upstreamWorkerTypes';
import * as extensionLog from '../../logging/extensionLog';

/** Notifies upstream workers when agent traffic is detected by the multiplexer MITM. */
export interface UpstreamNotifier {
  notifyAgentTraffic(
    upstreamId: string,
    summary: ProxyTrafficSummary,
    profileId: string,
    workspacePath: string
  ): void;
}

export interface UpstreamWorkerManagerOptions {
  profileManager?: IProfileManager;
  eventLogger?: MultiplexerEventLogger;
  extensionPath: string;
  /** When true, registers workers in-memory without forking child processes (tests). */
  testMode?: boolean;
}

/** Manages forked upstream analysis workers (one per profile+workspace). */
export class UpstreamWorkerManager implements UpstreamNotifier {
  private readonly workers = new Map<string, UpstreamWorkerProcess>();
  private readonly scriptPath: string;

  constructor(
    private readonly registry: IUpstreamWorkerRegistry,
    private readonly options: UpstreamWorkerManagerOptions
  ) {
    this.scriptPath = UpstreamWorkerProcess.resolveScriptPath(
      options.extensionPath
    );
  }

  static hashWorkspace(workspacePath: string): string {
    return crypto.createHash('sha256').update(workspacePath).digest('hex').slice(0, 8);
  }

  static buildUpstreamId(profileId: string, workspacePath: string): string {
    return `${profileId}-${UpstreamWorkerManager.hashWorkspace(workspacePath)}`;
  }

  async createWorker(
    profileId: string,
    workspacePath: string,
    userDataDir: string
  ): Promise<string> {
    const upstreamId = UpstreamWorkerManager.buildUpstreamId(profileId, workspacePath);
    const existing = this.registry.getById(upstreamId);
    if (existing?.healthy && this.workers.has(upstreamId)) {
      return upstreamId;
    }

    if (this.workers.has(upstreamId)) {
      await this.stopWorker(upstreamId);
    }

    const config = vscode.workspace.getConfiguration('cursorAccounts');
    const proxyConfig = vscode.workspace.getConfiguration('cursorAccounts.proxy');

    const worker = new UpstreamWorkerProcess(this.scriptPath, this.options.extensionPath);
    const record: UpstreamWorkerRecord = {
      id: upstreamId,
      profileId,
      workspacePath,
      healthy: false,
      trafficReceived: 0,
      startedAt: new Date(),
    };
    this.registry.register(record);

    if (this.options.testMode) {
      this.registry.setHealthy(upstreamId, true);
      void this.options.eventLogger?.logUpstreamCreated(
        upstreamId,
        profileId,
        workspacePath,
        0
      );
      extensionLog.info(
        `[Multiplexer] Upstream worker ${upstreamId} registered (test mode)`
      );
      return upstreamId;
    }

    worker.onExit(() => {
      this.registry.setHealthy(upstreamId, false);
      this.workers.delete(upstreamId);
    });

    try {
      await worker.start({
        upstreamId,
        profileId,
        workspacePath,
        userDataDir,
        extensionPath: this.options.extensionPath,
        useBetterSqlite3: config.get<boolean>('experimental.useBetterSqlite3', false),
        estimatedDollarsPerMillionTokens: proxyConfig.get<number>(
          'estimatedDollarsPerMillionTokens',
          4
        ),
      });
      this.workers.set(upstreamId, worker);
      this.registry.setHealthy(upstreamId, true);

      void this.options.eventLogger?.logUpstreamCreated(
        upstreamId,
        profileId,
        workspacePath,
        0
      );

      extensionLog.info(
        `[Multiplexer] Upstream worker ${upstreamId} started profile=${profileId} workspace=${workspacePath}`
      );
      return upstreamId;
    } catch (error) {
      this.registry.unregister(upstreamId);
      this.workers.delete(upstreamId);
      throw error;
    }
  }

  notifyAgentTraffic(
    upstreamId: string,
    summary: ProxyTrafficSummary,
    profileId: string,
    workspacePath: string
  ): void {
    const worker = this.workers.get(upstreamId);
    if (worker) {
      worker.sendTraffic(summary);
      this.registry.recordTraffic(upstreamId);
      return;
    }

    if (this.options.testMode && this.registry.getById(upstreamId)) {
      this.registry.recordTraffic(upstreamId);
      return;
    }

    void this.options.profileManager?.getProfile(profileId).then(async (profile) => {
      if (!profile) {
        return;
      }
      try {
        await this.createWorker(profileId, workspacePath, profile.userDataDir);
        this.workers.get(upstreamId)?.sendTraffic(summary);
        this.registry.recordTraffic(upstreamId);
      } catch (error) {
        extensionLog.warn(
          `[UpstreamWorkerManager] Failed to create worker on demand: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });
  }

  async stopWorker(upstreamId: string, reason?: string): Promise<void> {
    const worker = this.workers.get(upstreamId);
    if (worker) {
      await worker.stop();
      this.workers.delete(upstreamId);
    }
    this.registry.unregister(upstreamId);
    void this.options.eventLogger?.logUpstreamStopped(upstreamId, reason);
  }

  async stopWorkersForProfile(profileId: string): Promise<void> {
    for (const record of this.registry.listByProfile(profileId)) {
      await this.stopWorker(record.id);
    }
  }

  async stopAll(): Promise<void> {
    for (const upstreamId of [...this.workers.keys()]) {
      await this.stopWorker(upstreamId);
    }
  }

  getWorkersByProfile(profileId?: string): readonly UpstreamWorkerRecord[] {
    return profileId
      ? this.registry.listByProfile(profileId)
      : this.registry.getAll();
  }

  getWorkerCount(): number {
    return this.registry.getAll().length;
  }
}
