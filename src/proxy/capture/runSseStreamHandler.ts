import type { ProxyTrafficSummary } from '../../application/types/proxyTraffic';
import type { IProxyLiveCostCalculator } from '../../domain/ports/IProxyLiveCostCalculator';
import type { LiveTokenUpdate, TurnEndedEvent } from '../streamingAgentDecoder';
import { formatEndpoint } from '../proxyTrafficFormat';

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

    const deltaCostCents =
      update.deltaCostCents ??
      this.options.costCalculator?.calculateDeltaCost(
        update.latestDelta,
        modelId
      );

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

    this.onTraffic({
      timestamp: new Date().toISOString(),
      kind: 'response',
      url: context.url,
      host: context.host,
      endpoint: formatEndpoint(context.url, context.host),
      statusCode: context.statusCode,
      rpcPath: context.url.includes('/')
        ? context.url.replace(/^https?:\/\/[^/]+/, '')
        : undefined,
      isLiveTokenUpdate: true,
      liveTokenData: {
        accumulatedTokens: update.accumulatedTokens,
        latestDelta: update.latestDelta,
        modelId,
        deltaCostCents,
      },
      insights: {
        agent: {
          ...update.agent,
          requestId: context.bidiRequestId,
          conversationId,
          requestedModelId: modelId,
        },
        context: conversationId ? { conversationId } : undefined,
      },
      httpRequestId: context.httpRequestId,
      isCursorHost: context.isCursorHost,
    });
  }

  emitTurnEnded(event: TurnEndedEvent, context: RunSseEmitContext): void {
    const modelId =
      event.modelId ??
      event.agent.requestedModelId ??
      event.agent.modelName ??
      this.options.resolveModelId?.(context.bidiRequestId);

    const calculatedCostCents =
      event.calculatedCostCents ??
      this.options.costCalculator?.calculateTurnCost(
        {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadTokens,
          cacheWriteTokens: event.cacheWriteTokens,
        },
        modelId
      );

    const serverTotalCents = event.totalCents ?? event.agent.totalCents;
    const displayCents =
      serverTotalCents ??
      calculatedCostCents ??
      0;

    const conversationId =
      event.agent.conversationId ??
      this.options.resolveConversationId?.(context.bidiRequestId);

    this.onTraffic({
      timestamp: new Date().toISOString(),
      kind: 'response',
      url: context.url,
      host: context.host,
      endpoint: formatEndpoint(context.url, context.host),
      statusCode: context.statusCode,
      rpcPath: context.url.includes('/')
        ? context.url.replace(/^https?:\/\/[^/]+/, '')
        : undefined,
      isTurnEnded: true,
      insights: {
        agent: {
          ...event.agent,
          requestId: context.bidiRequestId,
          conversationId,
          requestedModelId: modelId,
          totalCents: displayCents > 0 ? displayCents : undefined,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadTokens,
          cacheWriteTokens: event.cacheWriteTokens,
          usageEvent: 'turn_ended',
        },
        tokens: {
          promptTokens: event.inputTokens,
          completionTokens: event.outputTokens,
          cachedTokens: event.cacheReadTokens,
          totalCents: serverTotalCents,
        },
        streamingTurnsAlreadyPersisted: true,
        context: conversationId ? { conversationId } : undefined,
      },
      httpRequestId: context.httpRequestId,
      isCursorHost: context.isCursorHost,
    });
  }
}
