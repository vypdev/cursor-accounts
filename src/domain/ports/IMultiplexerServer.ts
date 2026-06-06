import type { RoutingContext } from './IRoutingStrategy';
import type { Session } from '../entities/Session';

/** Callback invoked when a client connection is routed. */
export type RoutingHandler = (
  session: Session,
  context: RoutingContext
) => Promise<{ host: string; port: number; upstreamId: string }>;

/**
 * Port: TCP/HTTP multiplexor listener.
 */
export interface IMultiplexerServer {
  listen(port: number, host: string, handler: RoutingHandler): Promise<void>;
  close(): Promise<void>;
  isListening(): boolean;
  getPort(): number | undefined;
}
