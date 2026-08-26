import type { IProxyLiveCostCalculator } from '../../domain/ports/IProxyLiveCostCalculator';
import { normalizeCostCents } from '../../domain/services/tokenAccounting';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';
import type { AgentSessionInfo } from '../types/agentTracking';

export type AgentSessionMerger = (
  base: AgentSessionInfo | undefined,
  extra: AgentSessionInfo | undefined
) => AgentSessionInfo | undefined;

export type AgentLiveUsageCostCalculator = Pick<
  IProxyLiveCostCalculator,
  'calculateDeltaCost' | 'calculateTurnCost'
>;

export interface AgentLiveUsageSessionState {
  agent: AgentSessionInfo;
  /** CLI-style sum of token_delta during the current turn (UI only). */
  liveAccumulated: number;
  /** Sum of per-delta model-aware costs during the current turn (USD cents). */
  liveAccumulatedCostCents: number;
  /** Billing-grade total from server turn_ended. */
  billedTokens: number;
  /** Turn cost in USD cents (server or calculated). */
  turnTotalCents?: number;
  /** True when turnTotalCents came from server total_cents. */
  turnCostFromServer?: boolean;
  /** Active model id for this session. */
  modelId?: string;
  lastActivity: number;
  /** True when a billing-grade turn_ended came from live proxy decode. */
  turnEndedFromLive?: boolean;
}

export interface AgentLiveUsageStateDependencies {
  mergeAgentSessionInfo: AgentSessionMerger;
  costCalculator: AgentLiveUsageCostCalculator;
  now?: () => number;
}

type SessionUsageUpdate = Pick<
  AgentLiveUsageSessionState,
  | 'liveAccumulated'
  | 'liveAccumulatedCostCents'
  | 'billedTokens'
  | 'turnTotalCents'
  | 'turnCostFromServer'
>;

function mergeTrafficAgent(
  summary: ProxyTrafficSummary,
  mergeAgentSessionInfo: AgentSessionMerger
): AgentSessionInfo | undefined {
  const agent = summary.insights?.agent;
  const tokens = summary.insights?.tokens;
  let mergedAgent = mergeAgentSessionInfo(agent, {
    inputTokens: tokens?.promptTokens ?? agent?.inputTokens,
    outputTokens: tokens?.completionTokens ?? agent?.outputTokens,
    cacheReadTokens:
      tokens?.cacheReadTokens ?? tokens?.cachedTokens ?? agent?.cacheReadTokens,
    cacheWriteTokens: tokens?.cacheWriteTokens ?? agent?.cacheWriteTokens,
    totalCents: tokens?.totalCents ?? agent?.totalCents,
    requestedModelId: agent?.requestedModelId ?? agent?.modelName,
    streamingTokens:
      agent?.streamingTokens ??
      (tokens?.totalTokens != null &&
      tokens.promptTokens == null &&
      tokens.completionTokens == null
        ? tokens.totalTokens
        : undefined),
  });

  if (shouldUseTokenTotal(mergedAgent, tokens?.totalTokens)) {
    mergedAgent = mergeAgentSessionInfo(mergedAgent, {
      streamingTokens: tokens?.totalTokens,
      usageEvent: agent?.usageEvent ?? 'token_delta',
    });
  }

  if (!mergedAgent && summary.liveTokenData) {
    return {
      streamingTokens: summary.liveTokenData.accumulatedTokens,
      usageEvent: 'token_delta',
    };
  }
  return mergedAgent;
}

function shouldUseTokenTotal(
  agent: AgentSessionInfo | undefined,
  totalTokens: number | undefined
): boolean {
  return (
    agent != null &&
    totalTokens != null &&
    (agent.streamingTokens == null || totalTokens > agent.streamingTokens)
  );
}

function isStaleBatchTurnEnded(
  summary: ProxyTrafficSummary,
  agent: AgentSessionInfo,
  previous: AgentLiveUsageSessionState | undefined
): boolean {
  return (
    previous?.turnEndedFromLive === true &&
    summary.isTurnEnded !== true &&
    summary.isLiveTokenUpdate !== true &&
    agent.usageEvent === 'turn_ended'
  );
}

function resolveModelId(
  summary: ProxyTrafficSummary,
  agent: AgentSessionInfo,
  previous: AgentLiveUsageSessionState | undefined
): string | undefined {
  return (
    summary.liveTokenData?.modelId ??
    agent.requestedModelId ??
    agent.modelName ??
    previous?.modelId
  );
}

function updateSessionUsage(
  summary: ProxyTrafficSummary,
  agent: AgentSessionInfo,
  previous: AgentLiveUsageSessionState | undefined,
  modelId: string | undefined,
  costCalculator: AgentLiveUsageCostCalculator
): SessionUsageUpdate {
  let liveAccumulated = previous?.liveAccumulated ?? 0;
  let liveAccumulatedCostCents = previous?.liveAccumulatedCostCents ?? 0;
  let billedTokens = previous?.billedTokens ?? 0;
  let turnTotalCents = previous?.turnTotalCents;
  let turnCostFromServer = previous?.turnCostFromServer;

  if (summary.isLiveTokenUpdate && summary.liveTokenData) {
    liveAccumulated = summary.liveTokenData.accumulatedTokens;
    liveAccumulatedCostCents += calculateLiveDeltaCost(
      summary.liveTokenData.latestDelta,
      summary.liveTokenData.deltaCostCents,
      modelId,
      costCalculator
    );
  } else if (isAcceptedTurnEnded(summary, agent, previous)) {
    billedTokens = getBilledTokensForTurn(agent, billedTokens);
    liveAccumulated = 0;
    liveAccumulatedCostCents = 0;
    ({ turnTotalCents, turnCostFromServer } = resolveTurnCost(
      summary,
      agent,
      modelId,
      costCalculator
    ));
  } else if (agent.streamingTokens != null) {
    liveAccumulated = Math.max(liveAccumulated, agent.streamingTokens);
  }

  return {
    liveAccumulated,
    liveAccumulatedCostCents,
    billedTokens,
    turnTotalCents,
    turnCostFromServer,
  };
}

function calculateLiveDeltaCost(
  latestDelta: number,
  explicitCost: number | undefined,
  modelId: string | undefined,
  costCalculator: AgentLiveUsageCostCalculator
): number {
  if (!(latestDelta > 0)) {
    return 0;
  }
  return (
    explicitCost ?? costCalculator.calculateDeltaCost(latestDelta, modelId)
  );
}

function isAcceptedTurnEnded(
  summary: ProxyTrafficSummary,
  agent: AgentSessionInfo,
  previous: AgentLiveUsageSessionState | undefined
): boolean {
  const isTurnEnded =
    summary.isTurnEnded === true || agent.usageEvent === 'turn_ended';
  return (
    isTurnEnded &&
    (summary.isTurnEnded === true || previous?.turnEndedFromLive !== true)
  );
}

function getBilledTokensForTurn(
  agent: AgentSessionInfo,
  previousBilledTokens: number
): number {
  const billed = getBilledTokenTotal(agent);
  return billed > 0 ? billed : previousBilledTokens;
}

function resolveTurnCost(
  summary: ProxyTrafficSummary,
  agent: AgentSessionInfo,
  modelId: string | undefined,
  costCalculator: AgentLiveUsageCostCalculator
): Pick<SessionUsageUpdate, 'turnTotalCents' | 'turnCostFromServer'> {
  const serverCents = normalizeCostCents(summary.insights?.tokens?.totalCents);
  if (serverCents != null) {
    return { turnTotalCents: serverCents, turnCostFromServer: true };
  }

  const agentCents = normalizeCostCents(agent.totalCents);
  if (agentCents != null) {
    return { turnTotalCents: agentCents, turnCostFromServer: true };
  }

  return {
    turnTotalCents: costCalculator.calculateTurnCost(
      {
        inputTokens: agent.inputTokens ?? 0,
        outputTokens: agent.outputTokens ?? 0,
        cacheReadTokens: agent.cacheReadTokens,
        cacheWriteTokens: agent.cacheWriteTokens,
      },
      modelId
    ),
    turnCostFromServer: false,
  };
}

/**
 * Application state and accounting policy for the live usage status bar.
 *
 * This boundary deliberately knows nothing about VS Code, timers, or status
 * bar presentation. The interface adapter owns those concerns and supplies
 * the domain cost calculator and protocol-specific agent merger.
 */
export class AgentLiveUsageState {
  readonly sessions = new Map<string, AgentLiveUsageSessionState>();
  private currentSessionId: string | undefined;

  constructor(private readonly dependencies: AgentLiveUsageStateDependencies) {}

  get activeSessionId(): string | undefined {
    return this.currentSessionId;
  }

  ingest(summary: ProxyTrafficSummary): boolean {
    if (
      !summary.insights?.agent &&
      !summary.insights?.tokens &&
      !summary.liveTokenData
    ) {
      return false;
    }

    const sessionId =
      summary.insights?.agent?.requestId ??
      this.currentSessionId ??
      summary.requestId ??
      'active';
    const mergedAgent = mergeTrafficAgent(
      summary,
      this.dependencies.mergeAgentSessionInfo
    );
    if (!mergedAgent) {
      return false;
    }

    const previous = this.sessions.get(sessionId);
    if (isStaleBatchTurnEnded(summary, mergedAgent, previous)) {
      return false;
    }

    const modelId = resolveModelId(summary, mergedAgent, previous);
    const usage = updateSessionUsage(
      summary,
      mergedAgent,
      previous,
      modelId,
      this.dependencies.costCalculator
    );

    let finalAgent = mergedAgent;
    if (modelId) {
      finalAgent =
        this.dependencies.mergeAgentSessionInfo(mergedAgent, {
          requestedModelId: modelId,
        }) ?? mergedAgent;
    }

    finalAgent =
      this.dependencies.mergeAgentSessionInfo(previous?.agent, finalAgent) ??
      finalAgent;

    this.sessions.set(sessionId, {
      agent: finalAgent,
      ...usage,
      modelId,
      lastActivity: this.dependencies.now?.() ?? Date.now(),
      turnEndedFromLive:
        summary.isTurnEnded === true || previous?.turnEndedFromLive === true,
    });

    this.currentSessionId = sessionId;
    return true;
  }

  clear(): void {
    this.sessions.clear();
    this.currentSessionId = undefined;
  }
}

export function getBilledTokenTotal(agent: AgentSessionInfo): number {
  return (
    (agent.inputTokens ?? 0) +
    (agent.outputTokens ?? 0) +
    (agent.cacheReadTokens ?? 0) +
    (agent.cacheWriteTokens ?? 0)
  );
}
