import { RoutingDecision } from '../../../domain/entities/RoutingDecision';
import type { Session } from '../../../domain/entities/Session';
import type { Upstream } from '../../../domain/entities/Upstream';
import type {
  IRoutingStrategy,
  RoutingContext,
} from '../../../domain/ports/IRoutingStrategy';

/**
 * Tries a primary strategy and falls back when it throws.
 */
export class HybridStrategy implements IRoutingStrategy {
  readonly name = 'hybrid' as const;

  constructor(
    private readonly primary: IRoutingStrategy,
    private readonly fallback: IRoutingStrategy
  ) {}

  async selectUpstream(
    session: Session,
    availableUpstreams: readonly Upstream[],
    context?: RoutingContext
  ): Promise<RoutingDecision> {
    try {
      const decision = await this.primary.selectUpstream(
        session,
        availableUpstreams,
        context
      );
      return new RoutingDecision(
        decision.upstream,
        'hybrid-primary',
        decision.metadata
      );
    } catch {
      const decision = await this.fallback.selectUpstream(
        session,
        availableUpstreams,
        context
      );
      return new RoutingDecision(
        decision.upstream,
        'hybrid-fallback',
        decision.metadata
      );
    }
  }
}
