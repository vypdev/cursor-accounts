import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';
import type { IProxyLiveCostCalculator } from '../../domain/ports/IProxyLiveCostCalculator';
import type { LiveTokenUpdate, TurnEndedEvent } from '../streamingAgentDecoder';
import { formatEndpoint } from '../proxyTrafficFormat';
import {
  buildLiveTokenTrafficSummary,
  buildTurnEndedTrafficSummary,
  type RunSseTrafficContext,
} from '../../application/services/runSseTrafficPolicy';

export interface RunSseEmitContext {
  url: string;
  host: string;
  statusCode?: number;
  bidiRequestId?: string;
  httpRequestId?: string;
  isCursorHost: boolean;
}

export interface RunSseStreamHandlerOptions {
  costCalculator?: IProxyLiveCostCalculator;
  resolveModelId?: (bidiRequestId?: string) => string | undefined;
  resolveConversationId?: (bidiRequestId?: string) => string | undefined;
}

/**
 * Builds ProxyTrafficSummary events from incremental RunSSE decode results.
 */
export class RunSseStreamHandler {
  constructor(
    private readonly onTraffic: (summary: ProxyTrafficSummary) => void,
    private readonly options: RunSseStreamHandlerOptions = {}
  ) {}

  emitLiveTokenUpdate(
    update: LiveTokenUpdate,
    context: RunSseEmitContext
  ): void {
    const modelId =
      update.modelId ??
      update.agent.requestedModelId ??
      update.agent.modelName ??
      this.options.resolveModelId?.(context.bidiRequestId);

    const conversationId =
      update.agent.conversationId ??
      this.options.resolveConversationId?.(context.bidiRequestId);

    process.stderr.write(
      `[AgentTracking] emitLiveTokenUpdate bidi=${context.bidiRequestId?.slice(0, 8) ?? '(none)'}… ` +
        `http=${context.httpRequestId?.slice(0, 8) ?? '(none)'}… ` +
        `conv=${conversationId?.slice(0, 8) ?? '(none)'}… ` +
        `delta=${update.latestDelta} accumulated=${update.accumulatedTokens} ` +
        `usage=${update.agent.usageEvent ?? '(none)'}\n`
    );

    this.onTraffic(
      buildLiveTokenTrafficSummary(
        update,
        this.toTrafficContext(context, modelId, conversationId),
        { costCalculator: this.options.costCalculator }
      )
    );
  }

  emitTurnEnded(event: TurnEndedEvent, context: RunSseEmitContext): void {
    const modelId =
      event.modelId ??
      event.agent.requestedModelId ??
      event.agent.modelName ??
      this.options.resolveModelId?.(context.bidiRequestId);

    const conversationId =
      event.agent.conversationId ??
      this.options.resolveConversationId?.(context.bidiRequestId);

    this.onTraffic(
      buildTurnEndedTrafficSummary(
        event,
        this.toTrafficContext(context, modelId, conversationId),
        { costCalculator: this.options.costCalculator }
      )
    );
  }

  private toTrafficContext(
    context: RunSseEmitContext,
    modelId: string | undefined,
    conversationId: string | undefined
  ): RunSseTrafficContext {
    return {
      timestamp: new Date().toISOString(),
      url: context.url,
      host: context.host,
      endpoint: formatEndpoint(context.url, context.host),
      rpcPath: context.url.includes('/')
        ? context.url.replace(/^https?:\/\/[^/]+/, '')
        : undefined,
      statusCode: context.statusCode,
      bidiRequestId: context.bidiRequestId,
      httpRequestId: context.httpRequestId,
      isCursorHost: context.isCursorHost,
      modelId,
      conversationId,
    };
  }
}
