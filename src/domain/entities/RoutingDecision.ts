import type { RoutingReason } from '../types/multiplexerTypes';
import type { Upstream } from './Upstream';

/** Optional metadata attached to a routing decision. */
export interface RoutingMetadata {
  workspacePath?: string;
  tokenHash?: string;
  sessionKey?: string;
}

/**
 * Value object: upstream selection with reason and optional metadata.
 */
export class RoutingDecision {
  constructor(
    public readonly upstream: Upstream,
    public readonly reason: RoutingReason,
    public readonly metadata: RoutingMetadata = {}
  ) {}
}
