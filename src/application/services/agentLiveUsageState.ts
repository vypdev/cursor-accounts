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
    const agent = summary.insights?.agent;
    const tokens = summary.insights?.tokens;
    if (!agent && !tokens && !summary.liveTokenData) {
      return false;
    }

    const sessionId =
      agent?.requestId ??
      this.currentSessionId ??
      summary.requestId ??
      'active';

    let mergedAgent = this.dependencies.mergeAgentSessionInfo(agent, {
      inputTokens: tokens?.promptTokens ?? agent?.inputTokens,
      outputTokens: tokens?.completionTokens ?? agent?.outputTokens,
      cacheReadTokens:
        tokens?.cacheReadTokens ??
        tokens?.cachedTokens ??
        agent?.cacheReadTokens,
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

    if (
      mergedAgent &&
      tokens?.totalTokens != null &&
      (mergedAgent.streamingTokens == null ||
        tokens.totalTokens > mergedAgent.streamingTokens)
    ) {
      mergedAgent = this.dependencies.mergeAgentSessionInfo(mergedAgent, {
        streamingTokens: tokens.totalTokens,
        usageEvent: agent?.usageEvent ?? 'token_delta',
      });
    }

    if (!mergedAgent && summary.liveTokenData) {
      mergedAgent = {
        streamingTokens: summary.liveTokenData.accumulatedTokens,
        usageEvent: 'token_delta',
      };
    }

    if (!mergedAgent) {
      return false;
    }

    const previous = this.sessions.get(sessionId);
    if (
      previous?.turnEndedFromLive &&
      !summary.isTurnEnded &&
      !summary.isLiveTokenUpdate &&
      mergedAgent.usageEvent === 'turn_ended'
    ) {
      return false;
    }

    const modelId =
      summary.liveTokenData?.modelId ??
      mergedAgent.requestedModelId ??
      mergedAgent.modelName ??
      previous?.modelId;

    let liveAccumulated = previous?.liveAccumulated ?? 0;
    let liveAccumulatedCostCents = previous?.liveAccumulatedCostCents ?? 0;
    let billedTokens = previous?.billedTokens ?? 0;
    let turnTotalCents = previous?.turnTotalCents;
    let turnCostFromServer = previous?.turnCostFromServer;

    const isTurnEndedEvent =
      summary.isTurnEnded === true || mergedAgent.usageEvent === 'turn_ended';
    const acceptTurnEnded =
      isTurnEndedEvent &&
      (summary.isTurnEnded === true || !previous?.turnEndedFromLive);

    if (summary.isLiveTokenUpdate && summary.liveTokenData) {
      liveAccumulated = summary.liveTokenData.accumulatedTokens;
      if (summary.liveTokenData.latestDelta > 0) {
        const deltaCost =
          summary.liveTokenData.deltaCostCents ??
          this.dependencies.costCalculator.calculateDeltaCost(
            summary.liveTokenData.latestDelta,
            modelId
          );
        liveAccumulatedCostCents += deltaCost;
      }
    } else if (acceptTurnEnded) {
      const billed = getBilledTokenTotal(mergedAgent);
      if (billed > 0) {
        billedTokens = billed;
      }
      liveAccumulated = 0;
      liveAccumulatedCostCents = 0;

      const serverCents = normalizeCostCents(tokens?.totalCents);
      if (serverCents != null) {
        turnTotalCents = serverCents;
        turnCostFromServer = true;
      } else {
        const agentCents = normalizeCostCents(mergedAgent.totalCents);
        if (agentCents != null) {
          turnTotalCents = agentCents;
          turnCostFromServer = true;
        } else {
          turnTotalCents = this.dependencies.costCalculator.calculateTurnCost(
            {
              inputTokens: mergedAgent.inputTokens ?? 0,
              outputTokens: mergedAgent.outputTokens ?? 0,
              cacheReadTokens: mergedAgent.cacheReadTokens,
              cacheWriteTokens: mergedAgent.cacheWriteTokens,
            },
            modelId
          );
          turnCostFromServer = false;
        }
      }
    } else if (mergedAgent.streamingTokens != null) {
      liveAccumulated = Math.max(
        liveAccumulated,
        mergedAgent.streamingTokens
      );
    }

    if (modelId) {
      mergedAgent =
        this.dependencies.mergeAgentSessionInfo(mergedAgent, {
          requestedModelId: modelId,
        }) ?? mergedAgent;
    }

    const finalAgent =
      this.dependencies.mergeAgentSessionInfo(previous?.agent, mergedAgent) ??
      mergedAgent;

    this.sessions.set(sessionId, {
      agent: finalAgent,
      liveAccumulated,
      liveAccumulatedCostCents,
      billedTokens,
      turnTotalCents,
      turnCostFromServer,
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
