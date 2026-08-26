import type { IAgentTrackingRepository } from '../../domain/ports/IAgentTrackingRepository';
import type { IProxyLiveCostCalculator } from '../../domain/ports/IProxyLiveCostCalculator';
import type { ITokenTurnDetectionService } from '../../domain/ports/ITokenTurnDetectionService';
import type { AgentSessionInfo } from '../types/agentTracking';
import type { AgentPersistenceContext } from './agentTrackingPersistenceTypes';
import {
  normalizeCostCents,
  normalizeOptionalTokenCount,
  normalizeTokenCount,
} from '../../domain/services/tokenAccounting';

/** Writes one normalized agent-persistence strategy without choosing its priority. */
export class AgentTrackingPersistenceWriter {
  constructor(
    private readonly repository: IAgentTrackingRepository,
    private readonly turnDetectionService?: ITokenTurnDetectionService,
    private readonly costCalculator?: IProxyLiveCostCalculator
  ) {}

  async writeTurnEnded(context: AgentPersistenceContext): Promise<boolean> {
    const { summary, agent, timestamp, modelName } = context;
    if (!this.hasTurnUsage(agent)) {
      return false;
    }

    const totalCents = this.resolveTurnCostCents(agent, modelName);
    const inputTokens = normalizeTokenCount(agent.inputTokens);
    const outputTokens = normalizeTokenCount(agent.outputTokens);
    const cacheReadTokens = normalizeOptionalTokenCount(agent.cacheReadTokens);
    const cacheWriteTokens = normalizeOptionalTokenCount(agent.cacheWriteTokens);

    await this.repository.insertTurnEnded({
      requestId: agent.requestId!,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens: this.resolveTotalTokens(agent),
      totalCents,
      usageUuid: agent.usageUuid,
      recordedAt: timestamp,
      modelName,
      httpRequestId: summary.httpRequestId,
      eventKey: this.buildEventKey('turn_ended', context, {
        inputTokens: agent.inputTokens,
        outputTokens: agent.outputTokens,
        totalCents: agent.totalCents,
      }),
    });
    return true;
  }

  async writeContext(context: AgentPersistenceContext): Promise<boolean> {
    const { agent, timestamp, modelName } = context;
    if (!this.hasPersistableContext(agent)) {
      return false;
    }

    await this.repository.upsertTokenDelta({
      requestId: agent.requestId!,
      minuteBucket: this.minuteBucket(timestamp),
      streamingTokens: 0,
      contextUsedTokens: agent.contextUsedTokens,
      contextMaxTokens: agent.maxTokens,
      recordedAt: timestamp,
      modelName,
      eventKey: this.buildEventKey('token_details', context, {
        contextUsedTokens: agent.contextUsedTokens,
        contextMaxTokens: agent.maxTokens,
      }),
    });
    return true;
  }

  async writeLiveDelta(
    context: AgentPersistenceContext
  ): Promise<boolean | undefined> {
    const { summary, agent } = context;
    if (summary.isLiveTokenUpdate !== true || agent.usageEvent !== 'token_delta') {
      return undefined;
    }

    const increment = normalizeOptionalTokenCount(
      summary.liveTokenData?.latestDelta ?? agent.streamingTokens
    );
    if (increment == null || increment <= 0) {
      return false;
    }

    await this.persistDelta(context, increment, 'live_token_delta');
    return true;
  }

  async writeDetectedTurns(
    context: AgentPersistenceContext
  ): Promise<boolean | undefined> {
    const { summary, insights, agent, timestamp, modelName } = context;
    if (
      !insights.allTokenFrames?.length ||
      !this.turnDetectionService ||
      insights.streamingTurnsAlreadyPersisted
    ) {
      return undefined;
    }

    const turns = this.turnDetectionService.detectTurns(insights.allTokenFrames);
    for (const turn of turns) {
      await this.repository.insertTokenSnapshot({
        requestId: agent.requestId!,
        tokenType: 'delta',
        streamingTokens: turn.streamingTokens,
        totalTokens: turn.streamingTokens,
        recordedAt: timestamp,
        modelName,
        turnIndex: turn.turnIndex,
        httpRequestId: summary.httpRequestId,
        eventKey: this.buildEventKey('batch_turn', context, {
          turnIndex: turn.turnIndex,
          streamingTokens: turn.streamingTokens,
        }),
      });
    }
    return turns.length > 0;
  }

  async writeBatchDelta(
    context: AgentPersistenceContext
  ): Promise<boolean | undefined> {
    const { agent } = context;
    if (agent.usageEvent !== 'token_delta') {
      return undefined;
    }
    const increment = normalizeOptionalTokenCount(agent.streamingTokens);
    if (increment == null || increment <= 0) {
      return false;
    }

    await this.persistDelta(context, increment, 'batch_token_delta');
    return true;
  }

  async writeSnapshot(context: AgentPersistenceContext): Promise<boolean> {
    const { summary, insights, agent, timestamp, modelName } = context;
    if (!agent.usageEvent || !this.hasTokenData(agent)) {
      return false;
    }

    const totalTokens = this.resolveTotalTokens(agent, insights.tokens?.totalTokens);
    await this.repository.insertTokenSnapshot({
      requestId: agent.requestId!,
      tokenType: this.mapTokenType(agent.usageEvent),
      streamingTokens: normalizeOptionalTokenCount(agent.streamingTokens),
      inputTokens: normalizeOptionalTokenCount(agent.inputTokens),
      outputTokens: normalizeOptionalTokenCount(agent.outputTokens),
      cacheReadTokens: normalizeOptionalTokenCount(agent.cacheReadTokens),
      cacheWriteTokens: normalizeOptionalTokenCount(agent.cacheWriteTokens),
      totalTokens,
      usageUuid: agent.usageUuid,
      recordedAt: timestamp,
      modelName,
      httpRequestId: summary.httpRequestId,
      eventKey: this.buildEventKey('token_snapshot', context, {
        usageEvent: agent.usageEvent,
        streamingTokens: agent.streamingTokens,
        inputTokens: agent.inputTokens,
        outputTokens: agent.outputTokens,
        totalTokens,
      }),
    });
    return true;
  }

  hasPersistableContext(agent: AgentSessionInfo): boolean {
    const contextUsedTokens = normalizeOptionalTokenCount(
      agent.contextUsedTokens
    );
    const maxTokens = normalizeOptionalTokenCount(agent.maxTokens);
    return (
      contextUsedTokens != null && maxTokens != null && maxTokens > 0
    );
  }

  private async persistDelta(
    context: AgentPersistenceContext,
    increment: number,
    kind: 'live_token_delta' | 'batch_token_delta'
  ): Promise<void> {
    const { summary, agent, timestamp, modelName } = context;
    const modelId =
      summary.liveTokenData?.modelId ??
      agent.requestedModelId ??
      agent.modelName ??
      modelName;
    const precomputed = normalizeCostCents(
      summary.liveTokenData?.deltaCostCents
    );
    const costCents =
      precomputed != null
        ? precomputed
        : this.costCalculator?.calculateDeltaCost(increment, modelId) ?? 0;

    await this.repository.upsertTokenDelta({
      requestId: agent.requestId!,
      minuteBucket: this.minuteBucket(timestamp),
      streamingTokens: increment,
      costCents: normalizeCostCents(costCents) ?? undefined,
      contextUsedTokens: normalizeOptionalTokenCount(agent.contextUsedTokens),
      contextMaxTokens: normalizeOptionalTokenCount(agent.maxTokens),
      recordedAt: timestamp,
      modelName,
      eventKey: this.buildEventKey(kind, context, {
        increment,
        accumulatedTokens: summary.liveTokenData?.accumulatedTokens,
      }),
    });
  }

  private buildEventKey(
    kind: string,
    context: AgentPersistenceContext,
    details: Record<string, unknown> = {}
  ): string {
    const { summary, agent, timestamp } = context;
    const sequence = agent.eventSequence ?? agent.appendSeqno ?? agent.pollSeqno;
    const source = agent.usageUuid
      ? { usageUuid: agent.usageUuid }
      : sequence != null
        ? { eventSequence: sequence, httpRequestId: summary.httpRequestId }
        : { timestamp, httpRequestId: summary.httpRequestId, ...details };

    return JSON.stringify({
      kind,
      requestId: agent.requestId,
      ...source,
      ...(sequence == null && !agent.usageUuid ? details : {}),
    });
  }

  private minuteBucket(timestamp: number): number {
    return Math.floor(timestamp / 60) * 60;
  }

  private mapTokenType(
    usageEvent: NonNullable<AgentSessionInfo['usageEvent']>
  ): 'delta' | 'turn_ended' | 'token_details' {
    if (usageEvent === 'turn_ended') return 'turn_ended';
    if (usageEvent === 'token_delta') return 'delta';
    return 'token_details';
  }

  private hasTokenData(agent: AgentSessionInfo): boolean {
    return (
      normalizeOptionalTokenCount(agent.streamingTokens) != null ||
      normalizeOptionalTokenCount(agent.inputTokens) != null ||
      normalizeOptionalTokenCount(agent.outputTokens) != null ||
      normalizeOptionalTokenCount(agent.cacheReadTokens) != null ||
      normalizeOptionalTokenCount(agent.cacheWriteTokens) != null
    );
  }

  private resolveTotalTokens(agent: AgentSessionInfo, tokenTotal?: number): number | undefined {
    const normalizedTokenTotal = normalizeOptionalTokenCount(tokenTotal);
    if (normalizedTokenTotal != null) return normalizedTokenTotal;
    const billed =
      normalizeTokenCount(agent.inputTokens) +
      normalizeTokenCount(agent.outputTokens) +
      normalizeTokenCount(agent.cacheReadTokens) +
      normalizeTokenCount(agent.cacheWriteTokens);
    return billed > 0
      ? billed
      : normalizeOptionalTokenCount(agent.streamingTokens);
  }

  private resolveTurnCostCents(
    agent: AgentSessionInfo,
    modelName?: string
  ): number | undefined {
    const serverCost = normalizeCostCents(agent.totalCents);
    if (serverCost != null) {
      return serverCost;
    }

    if (!this.costCalculator) {
      return undefined;
    }

    const calculated = this.costCalculator.calculateTurnCost(
      {
        inputTokens: agent.inputTokens ?? 0,
        outputTokens: agent.outputTokens ?? 0,
        cacheReadTokens: agent.cacheReadTokens,
        cacheWriteTokens: agent.cacheWriteTokens,
      },
      agent.requestedModelId ?? agent.modelName ?? modelName
    );

    return normalizeCostCents(calculated);
  }

  private hasTurnUsage(agent: AgentSessionInfo): boolean {
    return (
      normalizeOptionalTokenCount(agent.inputTokens) != null ||
      normalizeOptionalTokenCount(agent.outputTokens) != null ||
      normalizeOptionalTokenCount(agent.cacheReadTokens) != null ||
      normalizeOptionalTokenCount(agent.cacheWriteTokens) != null ||
      normalizeCostCents(agent.totalCents) != null
    );
  }
}
