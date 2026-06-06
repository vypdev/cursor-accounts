import type { RoutingDecision } from '../entities/RoutingDecision';
import type { Session } from '../entities/Session';
import type { Upstream } from '../entities/Upstream';
import type { ISessionStore } from '../ports/ISessionStore';
import type {
  IRoutingStrategy,
  RoutingContext,
} from '../ports/IRoutingStrategy';
import { UpstreamSelector } from './UpstreamSelector';

/**
 * Domain service: applies routing policy with optional fallback strategy.
 */
export class RoutingPolicyEngine {
  private readonly primarySelector: UpstreamSelector;
  private readonly fallbackSelector?: UpstreamSelector;

  constructor(
    primaryStrategy: IRoutingStrategy,
    private readonly sessionStore: ISessionStore,
    fallbackStrategy?: IRoutingStrategy
  ) {
    this.primarySelector = new UpstreamSelector(primaryStrategy);
    this.fallbackSelector = fallbackStrategy
      ? new UpstreamSelector(fallbackStrategy)
      : undefined;
  }

  async route(
    session: Session,
    upstreams: readonly Upstream[],
    context?: RoutingContext
  ): Promise<RoutingDecision> {
    try {
      const decision = await this.primarySelector.select(
        session,
        upstreams,
        context
      );
      this.persistBinding(session, decision, context);
      return decision;
    } catch {
      if (!this.fallbackSelector) {
        throw new Error(`Routing failed for session ${session.key}`);
      }
      const decision = await this.fallbackSelector.select(
        session,
        upstreams,
        context
      );
      this.persistBinding(session, decision, context);
      return decision;
    }
  }

  private persistBinding(
    session: Session,
    decision: RoutingDecision,
    context?: RoutingContext
  ): void {
    const workspacePath =
      decision.metadata.workspacePath ?? context?.headers?.['x-workspace-path'];

    this.sessionStore.set({
      sessionKey: session.key,
      upstreamId: decision.upstream.id,
      assignedAt: new Date(),
      workspacePath,
    });

    if (workspacePath) {
      this.sessionStore.setWorkspaceMapping(
        workspacePath,
        decision.upstream.id
      );
    }
  }
}
