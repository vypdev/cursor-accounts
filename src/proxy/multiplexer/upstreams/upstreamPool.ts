import { Upstream } from '../../../domain/entities/Upstream';
import type {
  IUpstreamPool,
  UpstreamConfig,
  UpstreamMetadataFilter,
} from '../../../domain/ports/IUpstreamPool';

function workspaceIndexKey(
  workspacePath: string,
  profileId?: string
): string {
  return profileId ? `${profileId}:${workspacePath}` : workspacePath;
}

/** In-memory upstream pool with connection accounting and workspace indexing. */
export class UpstreamPool implements IUpstreamPool {
  private upstreams = new Map<string, Upstream>();
  private workspaceIndex = new Map<string, string>();
  private metadataStore = new Map<string, UpstreamConfig['metadata']>();

  async initialize(configs: readonly UpstreamConfig[]): Promise<void> {
    this.upstreams.clear();
    this.workspaceIndex.clear();
    this.metadataStore.clear();

    for (const config of configs) {
      await this.createUpstream(config);
    }
  }

  async createUpstream(config: UpstreamConfig): Promise<void> {
    const upstream = new Upstream(
      config.id,
      config.host,
      config.port,
      config.weight ?? 1,
      config.maxConnections ?? 100
    );
    this.upstreams.set(config.id, upstream);

    if (config.metadata) {
      this.metadataStore.set(config.id, config.metadata);
      if (config.metadata.workspacePath) {
        this.workspaceIndex.set(
          workspaceIndexKey(
            config.metadata.workspacePath,
            config.metadata.profileId
          ),
          config.id
        );
      }
    }
  }

  getAll(): readonly Upstream[] {
    return [...this.upstreams.values()];
  }

  getHealthy(): readonly Upstream[] {
    return this.getAll().filter((u) => u.canAcceptConnection());
  }

  getById(id: string): Upstream | undefined {
    return this.upstreams.get(id);
  }

  getByWorkspace(
    workspacePath: string,
    profileId?: string
  ): Upstream | undefined {
    const upstreamId = this.workspaceIndex.get(
      workspaceIndexKey(workspacePath, profileId)
    );
    return upstreamId ? this.upstreams.get(upstreamId) : undefined;
  }

  listByMetadata(filter: UpstreamMetadataFilter): readonly Upstream[] {
    const results: Upstream[] = [];
    for (const [id, metadata] of this.metadataStore.entries()) {
      if (
        filter.workspacePath &&
        metadata?.workspacePath !== filter.workspacePath
      ) {
        continue;
      }
      if (filter.profileId && metadata?.profileId !== filter.profileId) {
        continue;
      }
      const upstream = this.upstreams.get(id);
      if (upstream) {
        results.push(upstream);
      }
    }
    return results;
  }

  async removeUpstream(upstreamId: string): Promise<void> {
    const metadata = this.metadataStore.get(upstreamId);
    if (metadata?.workspacePath) {
      this.workspaceIndex.delete(
        workspaceIndexKey(metadata.workspacePath, metadata.profileId)
      );
    }
    this.metadataStore.delete(upstreamId);
    this.upstreams.delete(upstreamId);
  }

  recordConnectionStart(upstreamId: string): void {
    this.upstreams.get(upstreamId)?.incrementConnections();
  }

  recordConnectionEnd(upstreamId: string): void {
    this.upstreams.get(upstreamId)?.decrementConnections();
  }
}
