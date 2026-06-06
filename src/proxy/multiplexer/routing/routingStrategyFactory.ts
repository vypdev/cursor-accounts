import type { IRoutingStrategy } from '../../../domain/ports/IRoutingStrategy';
import type { IProfileManager } from '../../../domain/ports/IProfileManager';
import type { IProtoPayloadExtractor } from '../../../domain/ports/IProtoPayloadExtractor';
import type { ISessionStore } from '../../../domain/ports/ISessionStore';
import type { IUpstreamPool } from '../../../domain/ports/IUpstreamPool';
import type { RoutingStrategyName } from '../../../domain/types/multiplexerTypes';
import type { IMultiplexerFlowLogger } from '../../../application/types/multiplexerFlowLogger';
import { HybridStrategy } from './hybridStrategy';
import { LeastConnectionsStrategy } from './leastConnectionsStrategy';
import { RoundRobinStrategy } from './roundRobinStrategy';
import { StickySessionStrategy } from './stickySessionStrategy';
import { TokenHashStrategy } from './tokenHashStrategy';
import {
  WorkspacePathStrategy,
  type WorkspaceUpstreamCreator,
} from './workspacePathStrategy';

export interface RoutingStrategyFactoryOptions {
  profileManager?: IProfileManager;
  flowLogger?: IMultiplexerFlowLogger;
}

export function createRoutingStrategy(
  name: RoutingStrategyName,
  sessionStore: ISessionStore,
  payloadExtractor?: IProtoPayloadExtractor,
  onWorkspaceDiscovered?: WorkspaceUpstreamCreator,
  upstreamPool?: IUpstreamPool,
  options?: RoutingStrategyFactoryOptions
): IRoutingStrategy {
  switch (name) {
    case 'sticky-session':
      return new StickySessionStrategy(sessionStore);
    case 'token-hash':
      return new TokenHashStrategy();
    case 'round-robin':
      return new RoundRobinStrategy();
    case 'least-connections':
      return new LeastConnectionsStrategy();
    case 'workspace-path':
      if (!payloadExtractor) {
        throw new Error('workspace-path strategy requires IProtoPayloadExtractor');
      }
      return new WorkspacePathStrategy(
        payloadExtractor,
        sessionStore,
        onWorkspaceDiscovered,
        upstreamPool,
        options?.profileManager,
        options?.flowLogger
      );
    case 'hybrid':
      return new HybridStrategy(
        new StickySessionStrategy(sessionStore),
        new LeastConnectionsStrategy()
      );
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown routing strategy: ${exhaustive}`);
    }
  }
}
