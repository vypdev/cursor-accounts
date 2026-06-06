import type { RoutingDecision } from '../../domain/entities/RoutingDecision';
import type { Session } from '../../domain/entities/Session';
import type { IMultiplexerMetrics } from '../../domain/ports/IMultiplexerMetrics';
import type { IUpstreamPool } from '../../domain/ports/IUpstreamPool';
import type {
  IRoutingStrategy,
  RoutingContext,
} from '../../domain/ports/IRoutingStrategy';
import type { ISessionStore } from '../../domain/ports/ISessionStore';
import { RoutingPolicyEngine } from '../../domain/services/RoutingPolicyEngine';
import type { RoutingEvent } from '../types/routingEvent';

export type RoutingEventListener = (event: RoutingEvent) => void;

/**
 * Application service: orchestrates routing decisions for incoming traffic.
 */
export class RoutingOrchestrator {
  private readonly policyEngine: RoutingPolicyEngine;
  private readonly listeners: RoutingEventListener[] = [];

  constructor(
    primaryStrategy: IRoutingStrategy,
    sessionStore: ISessionStore,
    private readonly upstreamPool: IUpstreamPool,
    private readonly metrics?: IMultiplexerMetrics,
    fallbackStrategy?: IRoutingStrategy,
    private readonly onUpstreamActivity?: (upstreamId: string) => void
  ) {
    this.policyEngine = new RoutingPolicyEngine(
      primaryStrategy,
      sessionStore,
      fallbackStrategy
    );
  }

  onRouting(listener: RoutingEventListener): void {
    this.listeners.push(listener);
  }

  async route(
    session: Session,
    context?: RoutingContext
  ): Promise<RoutingDecision> {
    const decision = await this.policyEngine.route(
      session,
      this.upstreamPool.getHealthy(),
      context
    );

    this.upstreamPool.recordConnectionStart(decision.upstream.id);
    this.onUpstreamActivity?.(decision.upstream.id);
    this.metrics?.recordRouting(decision.upstream.id, decision.reason);
    this.metrics?.recordConnectionStart(decision.upstream.id);

    const event: RoutingEvent = {
      timestamp: new Date().toISOString(),
      sessionKey: session.key,
      upstreamId: decision.upstream.id,
      upstreamHost: decision.upstream.host,
      upstreamPort: decision.upstream.port,
      reason: decision.reason,
      strategy: decision.reason,
      targetHost: context?.headers?.host,
      workspacePath: decision.metadata.workspacePath,
    };

    for (const listener of this.listeners) {
      listener(event);
    }

    return decision;
  }

  releaseConnection(upstreamId: string): void {
    this.upstreamPool.recordConnectionEnd(upstreamId);
    this.metrics?.recordConnectionEnd(upstreamId);
  }
}
