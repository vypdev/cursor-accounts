import type { IAgentTrackingDbPool } from '../domain/ports/IAgentTrackingDbPool';
import { ProxyLiveCostCalculator } from '../domain/services/ProxyLiveCostCalculator';
import { TokenTurnDetectionService } from '../domain/services/tokenTurnDetectionService';
import { CursorModelPricingProvider } from '../modelEfficiency/cursorModelPricingProvider';
import { AgentTrackingService } from '../services/agentTrackingService';
import type { ProxyTrafficSummary } from './types';
import { isAgentMetricsTraffic } from './jwtProfileResolver';

/**
 * Persists agent traffic in the shared proxy child using a per-profile DB pool.
 * Only processes agent metrics traffic (filtered upstream).
 */
export class ProxyAgentTrackingIngress {
  private readonly services = new Map<string, AgentTrackingService>();
  private readonly profileTails = new Map<string, Promise<void>>();
  private closed = false;

  constructor(
    private readonly dbPool: IAgentTrackingDbPool,
    private readonly defaultProfileId: string
  ) {}

  enqueue(summary: ProxyTrafficSummary): Promise<void> {
    if (!isAgentMetricsTraffic(summary)) {
      return Promise.resolve();
    }

    const profileId = summary.profileId ?? this.defaultProfileId;
    if (!profileId || profileId === 'shared') {
      process.stderr.write(
        '[AgentTracking] skip: missing profileId on agent metrics traffic\n'
      );
      return Promise.resolve();
    }

    if (this.closed) {
      return Promise.reject(new Error('Agent tracking ingress is closed'));
    }

    const previous = this.profileTails.get(profileId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const service = await this.getOrCreateService(profileId);
        await service.ingestTraffic(summary);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(
          `[AgentTracking] ingest failed profile=${profileId}: ${message}\n`
        );
        throw error;
      })
      .finally(() => {
        if (this.profileTails.get(profileId) === current) {
          this.profileTails.delete(profileId);
        }
      });

    this.profileTails.set(profileId, current);
    return current;
  }

  /** Backwards-compatible alias for callers that already use ingest(). */
  ingest(summary: ProxyTrafficSummary): Promise<void> {
    return this.enqueue(summary);
  }

  async flush(): Promise<void> {
    await Promise.all(
      [...this.profileTails.values()].map((pending) => pending.catch(() => undefined))
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
    this.services.clear();
    await this.dbPool.closeAll();
  }

  private async getOrCreateService(profileId: string): Promise<AgentTrackingService> {
    let service = this.services.get(profileId);
    if (service) {
      return service;
    }

    const repository = await this.dbPool.getRepositoryForProfile(profileId);
    const turnDetectionService = new TokenTurnDetectionService();
    const liveCostCalculator = new ProxyLiveCostCalculator(
      new CursorModelPricingProvider()
    );
    service = new AgentTrackingService(
      repository,
      profileId,
      turnDetectionService,
      liveCostCalculator
    );
    await service.initialize();
    this.services.set(profileId, service);
    return service;
  }
}
