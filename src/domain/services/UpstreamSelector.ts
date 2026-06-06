import { RoutingError } from '../errors/RoutingError';
import type { RoutingDecision } from '../entities/RoutingDecision';
import type { Session } from '../entities/Session';
import type { Upstream } from '../entities/Upstream';
import type {
  IRoutingStrategy,
  RoutingContext,
} from '../ports/IRoutingStrategy';

/**
 * Domain service: delegates upstream selection to a routing strategy.
 */
export class UpstreamSelector {
  constructor(private readonly strategy: IRoutingStrategy) {}

  get strategyName(): string {
    return this.strategy.name;
  }

  async select(
    session: Session,
    upstreams: readonly Upstream[],
    context?: RoutingContext
  ): Promise<RoutingDecision> {
    const available = upstreams.filter((u) => u.canAcceptConnection());
    if (available.length === 0) {
      throw new RoutingError('No available upstreams', session.key);
    }

    const decision = await this.strategy.selectUpstream(
      session,
      available,
      context
    );

    if (!available.includes(decision.upstream)) {
      throw new RoutingError(
        `Strategy selected unavailable upstream: ${decision.upstream.id}`,
        session.key
      );
    }

    return decision;
  }
}
