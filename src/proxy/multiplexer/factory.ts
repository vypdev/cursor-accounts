import { MetricsAggregator } from '../../application/services/metricsAggregator';
import { MultiplexerService } from '../../application/services/multiplexerService';
import { RoutingOrchestrator } from '../../application/services/routingOrchestrator';
import { UpstreamHealthMonitor } from '../../application/services/upstreamHealthMonitor';
import type { MultiplexerConfig } from '../../application/types/multiplexerConfig';
import type { IMultiplexerFlowLogger } from '../../application/types/multiplexerFlowLogger';
import type { IProfileManager } from '../../domain/ports/IProfileManager';
import { MultiplexerServer } from './multiplexerServer';
import { MultiplexerMetricsCollector } from './metrics/multiplexerMetricsCollector';
import { ProtoPayloadExtractor } from './protoPayloadExtractor';
import { createRoutingStrategy } from './routing/routingStrategyFactory';
import type { WorkspaceUpstreamCreator } from './routing/workspacePathStrategy';
import { RoutingEventLogger } from './routingEventLogger';
import { InMemorySessionStore } from './storage/inMemorySessionStore';
import { HealthChecker } from './upstreams/healthChecker';
import { UpstreamPool } from './upstreams/upstreamPool';

export interface MultiplexerRuntime {
  service: MultiplexerService;
  metricsAggregator: MetricsAggregator;
  routingOrchestrator: RoutingOrchestrator;
  upstreamPool: UpstreamPool;
  sessionStore: InMemorySessionStore;
}

export interface MultiplexerRuntimeOptions {
  profileManager?: IProfileManager;
  flowLogger?: IMultiplexerFlowLogger;
  onUpstreamCreate?: WorkspaceUpstreamCreator;
  onUpstreamActivity?: (upstreamId: string) => void;
}

/** Builds a fully wired multiplexor runtime from configuration. */
export function createMultiplexerRuntime(
  config: MultiplexerConfig,
  options?: MultiplexerRuntimeOptions
): MultiplexerRuntime {
  const sessionStore = new InMemorySessionStore();
  const upstreamPool = new UpstreamPool();
  const payloadExtractor = new ProtoPayloadExtractor();
  const strategyOptions = {
    profileManager: options?.profileManager,
    flowLogger: options?.flowLogger,
  };
  const primaryStrategy = createRoutingStrategy(
    config.routing.strategy,
    sessionStore,
    payloadExtractor,
    options?.onUpstreamCreate,
    upstreamPool,
    strategyOptions
  );
  const fallbackStrategy = config.routing.fallbackStrategy
    ? createRoutingStrategy(
        config.routing.fallbackStrategy,
        sessionStore,
        payloadExtractor,
        undefined,
        upstreamPool,
        strategyOptions
      )
    : undefined;

  const metrics = new MultiplexerMetricsCollector();
  const routingOrchestrator = new RoutingOrchestrator(
    primaryStrategy,
    sessionStore,
    upstreamPool,
    metrics,
    fallbackStrategy,
    options?.onUpstreamActivity
  );

  const eventLogger = new RoutingEventLogger();
  routingOrchestrator.onRouting((event) => {
    void eventLogger.append(event);
  });

  const healthMonitor = new UpstreamHealthMonitor(
    new HealthChecker({
      timeoutMs: config.health.timeoutMs,
      unhealthyThreshold: config.health.unhealthyThreshold,
    })
  );

  const metricsAggregator = new MetricsAggregator(
    metrics,
    upstreamPool,
    config.routing.strategy,
    config.router.port
  );

  const service = new MultiplexerService(
    new MultiplexerServer(),
    upstreamPool,
    sessionStore,
    healthMonitor,
    routingOrchestrator,
    metricsAggregator
  );

  return {
    service,
    metricsAggregator,
    routingOrchestrator,
    upstreamPool,
    sessionStore,
  };
}
