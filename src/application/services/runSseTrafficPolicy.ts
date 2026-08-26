import type { IProxyLiveCostCalculator } from '../../domain/ports/IProxyLiveCostCalculator';
import { normalizeCostCents } from '../../domain/services/tokenAccounting';
import type { CostSource } from '../../domain/types/costProvenance';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';
import type {
  LiveTokenUpdate,
  TurnEndedEvent,
} from './streamingAgentDecoderPolicy';

export interface RunSseTrafficContext {
  timestamp: string;
  url: string;
  host: string;
  endpoint: string;
  rpcPath?: string;
  statusCode?: number;
  bidiRequestId?: string;
  httpRequestId?: string;
  isCursorHost: boolean;
  modelId?: string;
  conversationId?: string;
}

export interface RunSseTrafficPolicyDependencies {
  costCalculator?: IProxyLiveCostCalculator;
}

type SupportedCostSource = Exclude<CostSource, 'mixed' | 'unknown'>;

function baseSummary(context: RunSseTrafficContext): ProxyTrafficSummary {
  return {
    timestamp: context.timestamp,
    kind: 'response',
    url: context.url,
    host: context.host,
    endpoint: context.endpoint,
    rpcPath: context.rpcPath,
    statusCode: context.statusCode,
    httpRequestId: context.httpRequestId,
    isCursorHost: context.isCursorHost,
  };
}

function supportedCostSource(
  source: CostSource | undefined
): SupportedCostSource | undefined {
  return source === 'unknown' || source === 'mixed' ? undefined : source;
}

function buildLiveCost(
  update: LiveTokenUpdate,
  modelId: string | undefined,
  costCalculator: IProxyLiveCostCalculator | undefined
): {
  deltaCostCents?: number;
  costSource?: SupportedCostSource;
  pricingSnapshotVersion?: string;
} {
  const calculated =
    update.deltaCostCents == null
      ? costCalculator?.estimateDeltaCost(update.latestDelta, modelId)
      : undefined;
  const deltaCostCents = update.deltaCostCents ?? calculated?.costCents;
  const costSource = supportedCostSource(
    update.costSource ??
      calculated?.source ??
      (deltaCostCents != null ? 'provided' : undefined)
  );

  return {
    deltaCostCents,
    costSource,
    pricingSnapshotVersion:
      update.pricingSnapshotVersion ?? calculated?.pricingSnapshotVersion,
  };
}

function buildTurnCost(
  event: TurnEndedEvent,
  modelId: string | undefined,
  costCalculator: IProxyLiveCostCalculator | undefined
): {
  totalCents?: number;
  costSource?: CostSource;
  pricingSnapshotVersion?: string;
  serverTotalCents?: number;
} {
  const calculatedTurn =
    event.calculatedCostCents != null
      ? {
          costCents: event.calculatedCostCents,
          source: event.calculatedCostSource ?? ('provided' as const),
          pricingSnapshotVersion: event.pricingSnapshotVersion,
        }
      : costCalculator?.estimateTurnCost(
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
  const totalCents = normalizeCostCents(selectedTurn?.costCents);
  const costSource = totalCents != null ? selectedTurn?.source : undefined;

  return {
    totalCents,
    costSource,
    pricingSnapshotVersion:
      costSource === 'model_pricing'
        ? selectedTurn?.pricingSnapshotVersion
        : undefined,
    serverTotalCents:
      costSource === 'server' ? totalCents : undefined,
  };
}

/**
 * Converts one decoded live token update into the domain traffic event used by
 * persistence, UI, and API adapters. No clock, process, or transport access is
 * required, so cost precedence is directly testable as an application policy.
 */
export function buildLiveTokenTrafficSummary(
  update: LiveTokenUpdate,
  context: RunSseTrafficContext,
  dependencies: RunSseTrafficPolicyDependencies = {}
): ProxyTrafficSummary {
  const cost = buildLiveCost(
    update,
    context.modelId,
    dependencies.costCalculator
  );

  return {
    ...baseSummary(context),
    isLiveTokenUpdate: true,
    liveTokenData: {
      accumulatedTokens: update.accumulatedTokens,
      latestDelta: update.latestDelta,
      modelId: context.modelId,
      deltaCostCents: cost.deltaCostCents,
      costSource: cost.costSource,
      pricingSnapshotVersion: cost.pricingSnapshotVersion,
    },
    insights: {
      agent: {
        ...update.agent,
        requestId: context.bidiRequestId,
        conversationId: context.conversationId,
        requestedModelId: context.modelId,
      },
      context: context.conversationId
        ? { conversationId: context.conversationId }
        : undefined,
    },
  };
}

/**
 * Converts a billing-grade turn-ended event into a persistence-ready traffic
 * event while preserving the authoritative server-cost precedence contract.
 */
export function buildTurnEndedTrafficSummary(
  event: TurnEndedEvent,
  context: RunSseTrafficContext,
  dependencies: RunSseTrafficPolicyDependencies = {}
): ProxyTrafficSummary {
  const cost = buildTurnCost(
    event,
    context.modelId,
    dependencies.costCalculator
  );

  return {
    ...baseSummary(context),
    isTurnEnded: true,
    insights: {
      agent: {
        ...event.agent,
        requestId: context.bidiRequestId,
        conversationId: context.conversationId,
        requestedModelId: context.modelId,
        totalCents: cost.costSource != null ? cost.totalCents : undefined,
        costSource: cost.costSource,
        pricingSnapshotVersion: cost.pricingSnapshotVersion,
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
        totalCents: cost.serverTotalCents,
      },
      streamingTurnsAlreadyPersisted: true,
      context: context.conversationId
        ? { conversationId: context.conversationId }
        : undefined,
    },
  };
}
