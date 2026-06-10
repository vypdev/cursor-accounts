import type { UpstreamWorkerRecord } from '../../proxy/multiplexer/upstreamWorkerTypes';

/** Port for tracking upstream analysis workers (not proxy endpoints). */
export interface IUpstreamWorkerRegistry {
  register(record: UpstreamWorkerRecord): void;
  unregister(upstreamId: string): void;
  getById(upstreamId: string): UpstreamWorkerRecord | undefined;
  getByWorkspace(workspacePath: string, profileId?: string): UpstreamWorkerRecord | undefined;
  listByProfile(profileId: string): readonly UpstreamWorkerRecord[];
  getAll(): readonly UpstreamWorkerRecord[];
  recordTraffic(upstreamId: string): void;
  setHealthy(upstreamId: string, healthy: boolean): void;
}
