import { RoutingDecision } from '../../../domain/entities/RoutingDecision';
import type { Session } from '../../../domain/entities/Session';
import type { Upstream } from '../../../domain/entities/Upstream';
import type {
  IRoutingStrategy,
  RoutingContext,
} from '../../../domain/ports/IRoutingStrategy';
import type { ISessionStore } from '../../../domain/ports/ISessionStore';
import {
  filterAvailableUpstreams,
  pickRoundRobin,
} from './routingStrategyUtils';

/**
 * Sticky sessions keyed by client source IP:port.
 */
export class StickySessionStrategy implements IRoutingStrategy {
  readonly name = 'sticky-session' as const;
  private roundRobinIndex = 0;

  constructor(private readonly sessionStore: ISessionStore) {}

  selectUpstream(
    session: Session,
    availableUpstreams: readonly Upstream[],
    _context?: RoutingContext
  ): RoutingDecision {
    const available = filterAvailableUpstreams(availableUpstreams);
    const existing = this.sessionStore.get(session);

    if (existing) {
      const upstream = available.find((u) => u.id === existing.upstreamId);
      if (upstream) {
        return new RoutingDecision(upstream, 'sticky-session-hit', {
          sessionKey: session.key,
          workspacePath: existing.workspacePath,
        });
      }
      this.sessionStore.delete(session);
    }

    const picked = pickRoundRobin(available, this.roundRobinIndex);
    this.roundRobinIndex = picked.nextIndex;
    this.sessionStore.set({
      sessionKey: session.key,
      upstreamId: picked.upstream.id,
      assignedAt: new Date(),
    });

    return new RoutingDecision(picked.upstream, 'sticky-session-new', {
      sessionKey: session.key,
    });
  }
}
