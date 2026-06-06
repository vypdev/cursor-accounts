import { RoutingDecision } from '../../../domain/entities/RoutingDecision';
import type { Session } from '../../../domain/entities/Session';
import type { Upstream } from '../../../domain/entities/Upstream';
import type {
  IRoutingStrategy,
  RoutingContext,
} from '../../../domain/ports/IRoutingStrategy';
import {
  filterAvailableUpstreams,
  pickLeastConnections,
} from './routingStrategyUtils';

/** Routes to the upstream with the fewest active connections. */
export class LeastConnectionsStrategy implements IRoutingStrategy {
  readonly name = 'least-connections' as const;

  selectUpstream(
    _session: Session,
    availableUpstreams: readonly Upstream[],
    _context?: RoutingContext
  ): RoutingDecision {
    const available = filterAvailableUpstreams(availableUpstreams);
    const upstream = pickLeastConnections(available);
    return new RoutingDecision(upstream, 'least-connections');
  }
}
