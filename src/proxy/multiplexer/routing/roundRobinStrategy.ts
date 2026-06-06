import { RoutingDecision } from '../../../domain/entities/RoutingDecision';
import type { Session } from '../../../domain/entities/Session';
import type { Upstream } from '../../../domain/entities/Upstream';
import type {
  IRoutingStrategy,
  RoutingContext,
} from '../../../domain/ports/IRoutingStrategy';
import {
  filterAvailableUpstreams,
  pickRoundRobin,
} from './routingStrategyUtils';

/** Distributes requests cyclically across available upstreams. */
export class RoundRobinStrategy implements IRoutingStrategy {
  readonly name = 'round-robin' as const;
  private index = 0;

  selectUpstream(
    _session: Session,
    availableUpstreams: readonly Upstream[],
    _context?: RoutingContext
  ): RoutingDecision {
    const available = filterAvailableUpstreams(availableUpstreams);
    const picked = pickRoundRobin(available, this.index);
    this.index = picked.nextIndex;
    return new RoutingDecision(picked.upstream, 'round-robin');
  }
}
