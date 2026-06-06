import { createHash } from 'node:crypto';
import { RoutingDecision } from '../../../domain/entities/RoutingDecision';
import type { Session } from '../../../domain/entities/Session';
import type { Upstream } from '../../../domain/entities/Upstream';
import type {
  IRoutingStrategy,
  RoutingContext,
} from '../../../domain/ports/IRoutingStrategy';
import { filterAvailableUpstreams } from './routingStrategyUtils';

/**
 * Consistent routing by Authorization header hash (account-level stickiness).
 */
export class TokenHashStrategy implements IRoutingStrategy {
  readonly name = 'token-hash' as const;
  private readonly tokenToUpstream = new Map<string, string>();

  selectUpstream(
    session: Session,
    availableUpstreams: readonly Upstream[],
    context?: RoutingContext
  ): RoutingDecision {
    const available = filterAvailableUpstreams(availableUpstreams);
    const auth = context?.headers?.authorization ?? context?.headers?.Authorization;
    const tokenHash = auth
      ? createHash('sha256').update(auth).digest('hex')
      : session.key;

    const existingId = this.tokenToUpstream.get(tokenHash);
    if (existingId) {
      const upstream = available.find((u) => u.id === existingId);
      if (upstream) {
        return new RoutingDecision(upstream, 'token-hash', {
          tokenHash,
          sessionKey: session.key,
        });
      }
      this.tokenToUpstream.delete(tokenHash);
    }

    const index = parseInt(tokenHash.slice(0, 8), 16) % available.length;
    const upstream = available[index]!;
    this.tokenToUpstream.set(tokenHash, upstream.id);

    return new RoutingDecision(upstream, 'token-hash', {
      tokenHash,
      sessionKey: session.key,
    });
  }
}
