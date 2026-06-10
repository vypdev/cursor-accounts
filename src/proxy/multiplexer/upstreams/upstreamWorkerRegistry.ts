import type { IUpstreamWorkerRegistry } from '../../../domain/ports/IUpstreamWorkerRegistry';
import type { UpstreamWorkerRecord } from '../upstreamWorkerTypes';

function workspaceKey(workspacePath: string, profileId?: string): string {
  return profileId ? `${profileId}:${workspacePath}` : workspacePath;
}

/** In-memory registry of upstream analysis workers. */
export class UpstreamWorkerRegistry implements IUpstreamWorkerRegistry {
  private readonly workers = new Map<string, UpstreamWorkerRecord>();
  private readonly workspaceIndex = new Map<string, string>();

  register(record: UpstreamWorkerRecord): void {
    this.workers.set(record.id, record);
    this.workspaceIndex.set(
      workspaceKey(record.workspacePath, record.profileId),
      record.id
    );
  }

  unregister(upstreamId: string): void {
    const record = this.workers.get(upstreamId);
    if (record) {
      this.workspaceIndex.delete(
        workspaceKey(record.workspacePath, record.profileId)
      );
    }
    this.workers.delete(upstreamId);
  }

  getById(upstreamId: string): UpstreamWorkerRecord | undefined {
    return this.workers.get(upstreamId);
  }

  getByWorkspace(
    workspacePath: string,
    profileId?: string
  ): UpstreamWorkerRecord | undefined {
    const id = this.workspaceIndex.get(workspaceKey(workspacePath, profileId));
    return id ? this.workers.get(id) : undefined;
  }

  listByProfile(profileId: string): readonly UpstreamWorkerRecord[] {
    return [...this.workers.values()].filter((w) => w.profileId === profileId);
  }

  getAll(): readonly UpstreamWorkerRecord[] {
    return [...this.workers.values()];
  }

  recordTraffic(upstreamId: string): void {
    const record = this.workers.get(upstreamId);
    if (record) {
      record.trafficReceived += 1;
    }
  }

  setHealthy(upstreamId: string, healthy: boolean): void {
    const record = this.workers.get(upstreamId);
    if (record) {
      record.healthy = healthy;
    }
  }
}
