import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';
import type { IProxyLiveCostCalculator } from '../../domain/ports/IProxyLiveCostCalculator';
import { normalizeCostCents } from '../../domain/services/tokenAccounting';
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

    const calculatedDelta =
      update.deltaCostCents == null
        ? this.options.costCalculator?.estimateDeltaCost(
            update.latestDelta,
            modelId
          )
        : undefined;
    const deltaCostCents = update.deltaCostCents ?? calculatedDelta?.costCents;
    const candidateCostSource =
      update.costSource ??
      calculatedDelta?.source ??
      (deltaCostCents != null ? 'provided' : undefined);
    const costSource =
      candidateCostSource === 'unknown' || candidateCostSource === 'mixed'
        ? undefined
        : candidateCostSource;
    const pricingSnapshotVersion =
      update.pricingSnapshotVersion ?? calculatedDelta?.pricingSnapshotVersion;

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
        costSource,
        pricingSnapshotVersion,
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

    const calculatedTurn =
      event.calculatedCostCents != null
        ? {
            costCents: event.calculatedCostCents,
            source: event.calculatedCostSource ?? ('provided' as const),
            pricingSnapshotVersion: event.pricingSnapshotVersion,
          }
        : this.options.costCalculator?.estimateTurnCost(
            {
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              cacheReadTokens: event.cacheReadTokens,
              cacheWriteTokens: event.cacheWriteTokens,
            },
            modelId
          );

    const explicitServerTotalCents = normalizeCostCents(event.totalCents);
    const carriedAgentCostCents = normalizeCostCents(event.agent.totalCents);
    const carriedAgentCost =
      carriedAgentCostCents != null
        ? {
            costCents: carriedAgentCostCents,
            source: event.agent.costSource ?? ('server' as const),
            pricingSnapshotVersion: event.agent.pricingSnapshotVersion,
          }
        : undefined;
    const selectedTurn =
      explicitServerTotalCents != null
        ? { costCents: explicitServerTotalCents, source: 'server' as const }
        : carriedAgentCost ?? calculatedTurn;
    const normalizedCalculatedCostCents = normalizeCostCents(
      selectedTurn?.costCents
    );
    const costSource =
      normalizedCalculatedCostCents != null ? selectedTurn?.source : undefined;
    const pricingSnapshotVersion =
      costSource === 'model_pricing'
        ? selectedTurn?.pricingSnapshotVersion
        : undefined;
    const displayCents =
      normalizedCalculatedCostCents ??
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
          totalCents: costSource != null ? displayCents : undefined,
          costSource,
          pricingSnapshotVersion,
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
          totalCents:
            costSource === 'server' ? normalizedCalculatedCostCents : undefined,
        },
        streamingTurnsAlreadyPersisted: true,
        context: conversationId ? { conversationId } : undefined,
      },
      httpRequestId: context.httpRequestId,
      isCursorHost: context.isCursorHost,
    });
  }
}
