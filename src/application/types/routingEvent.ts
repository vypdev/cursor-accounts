import type { RoutingReason } from '../../domain/types/multiplexerTypes';

/** Event emitted when the multiplexor routes a connection. */
export interface RoutingEvent {
  timestamp: string;
  sessionKey: string;
  upstreamId: string;
  upstreamHost: string;
  upstreamPort: number;
  reason: RoutingReason;
  strategy: string;
  targetHost?: string;
  workspacePath?: string;
}
