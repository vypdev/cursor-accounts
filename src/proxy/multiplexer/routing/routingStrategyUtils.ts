import { RoutingError } from '../../../domain/errors/RoutingError';
import type { Upstream } from '../../../domain/entities/Upstream';

/** Returns upstreams that can accept connections. */
export function filterAvailableUpstreams(
  upstreams: readonly Upstream[]
): Upstream[] {
  return upstreams.filter((u) => u.canAcceptConnection());
}

/** Picks the next upstream using round-robin over available slots. */
export function pickRoundRobin(
  available: readonly Upstream[],
  index: number
): { upstream: Upstream; nextIndex: number } {
  if (available.length === 0) {
    throw new RoutingError('No available upstreams');
  }
  const upstream = available[index % available.length]!;
  return { upstream, nextIndex: index + 1 };
}

/** Picks upstream with the fewest active connections. */
export function pickLeastConnections(available: readonly Upstream[]): Upstream {
  if (available.length === 0) {
    throw new RoutingError('No available upstreams');
  }
  return available.reduce((best, current) =>
    current.connectionCount < best.connectionCount ? current : best
  );
}
