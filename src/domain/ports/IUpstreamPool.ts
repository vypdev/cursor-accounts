import type { Upstream } from '../entities/Upstream';

/** Configuration used to initialize an upstream slot. */
export interface UpstreamConfig {
  id: string;
  host: string;
  port: number;
  weight?: number;
  maxConnections?: number;
  metadata?: {
    workspacePath?: string;
    profileId?: string;
  };
}

export interface UpstreamMetadataFilter {
  workspacePath?: string;
  profileId?: string;
}

/**
 * Port: manages the pool of MITM upstream proxies.
 */
export interface IUpstreamPool {
  initialize(configs: readonly UpstreamConfig[]): Promise<void>;
  getAll(): readonly Upstream[];
  getHealthy(): readonly Upstream[];
  getById(id: string): Upstream | undefined;
  recordConnectionStart(upstreamId: string): void;
  recordConnectionEnd(upstreamId: string): void;
  createUpstream(config: UpstreamConfig): Promise<void>;
  getByWorkspace(workspacePath: string, profileId?: string): Upstream | undefined;
  removeUpstream(upstreamId: string): Promise<void>;
  listByMetadata(filter: UpstreamMetadataFilter): readonly Upstream[];
  getMetadata(upstreamId: string): UpstreamConfig['metadata'] | undefined;
}
