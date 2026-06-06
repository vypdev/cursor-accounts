import type { RoutingDecision } from '../entities/RoutingDecision';
import type { Session } from '../entities/Session';
import type { Upstream } from '../entities/Upstream';
import type { RoutingStrategyName } from '../types/multiplexerTypes';

/** Optional HTTP context for advanced routing strategies. */
export interface RoutingContext {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  payload?: Uint8Array;
}

/**
 * Port: selects an upstream for an incoming client session.
 */
export interface IRoutingStrategy {
  readonly name: RoutingStrategyName;

  selectUpstream(
    session: Session,
    availableUpstreams: readonly Upstream[],
    context?: RoutingContext
  ): RoutingDecision | Promise<RoutingDecision>;
}
