import type { IAgentTrackingRepository } from '../../domain/ports/IAgentTrackingRepository';
import type { IProxyLiveCostCalculator } from '../../domain/ports/IProxyLiveCostCalculator';
import type { ITokenTurnDetectionService } from '../../domain/ports/ITokenTurnDetectionService';
import type { AgentSessionInfo } from '../types/agentTracking';
import type { AgentPersistenceContext } from './agentTrackingPersistenceTypes';

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

    await this.repository.insertTurnEnded({
      requestId: agent.requestId!,
      inputTokens: agent.inputTokens ?? 0,
      outputTokens: agent.outputTokens ?? 0,
      cacheReadTokens: agent.cacheReadTokens,
      cacheWriteTokens: agent.cacheWriteTokens,
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

    const increment = summary.liveTokenData?.latestDelta ?? agent.streamingTokens;
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
    if (agent.streamingTokens == null || agent.streamingTokens <= 0) {
      return false;
    }

    await this.persistDelta(context, agent.streamingTokens, 'batch_token_delta');
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
      streamingTokens: agent.streamingTokens,
      inputTokens: agent.inputTokens,
      outputTokens: agent.outputTokens,
      cacheReadTokens: agent.cacheReadTokens,
      cacheWriteTokens: agent.cacheWriteTokens,
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
    return (
      agent.contextUsedTokens != null &&
      agent.maxTokens != null &&
      agent.maxTokens > 0
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
    const precomputed = summary.liveTokenData?.deltaCostCents;
    const costCents =
      precomputed != null && precomputed > 0
        ? precomputed
        : this.costCalculator?.calculateDeltaCost(increment, modelId) ?? 0;

    await this.repository.upsertTokenDelta({
      requestId: agent.requestId!,
      minuteBucket: this.minuteBucket(timestamp),
      streamingTokens: increment,
      costCents: costCents > 0 ? costCents : undefined,
      contextUsedTokens: agent.contextUsedTokens,
      contextMaxTokens: agent.maxTokens,
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
      agent.streamingTokens != null ||
      agent.inputTokens != null ||
      agent.outputTokens != null ||
      agent.cacheReadTokens != null ||
      agent.cacheWriteTokens != null
    );
  }

  private resolveTotalTokens(agent: AgentSessionInfo, tokenTotal?: number): number | undefined {
    if (tokenTotal != null) return tokenTotal;
    const billed =
      (agent.inputTokens ?? 0) +
      (agent.outputTokens ?? 0) +
      (agent.cacheReadTokens ?? 0) +
      (agent.cacheWriteTokens ?? 0);
    return billed > 0 ? billed : agent.streamingTokens;
  }

  private resolveTurnCostCents(
    agent: AgentSessionInfo,
    modelName?: string
  ): number | undefined {
    if (
      agent.totalCents != null &&
      Number.isFinite(agent.totalCents) &&
      agent.totalCents >= 0
    ) {
      return agent.totalCents;
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

    return Number.isFinite(calculated) && calculated >= 0 ? calculated : undefined;
  }

  private hasTurnUsage(agent: AgentSessionInfo): boolean {
    return (
      agent.inputTokens != null ||
      agent.outputTokens != null ||
      agent.cacheReadTokens != null ||
      agent.cacheWriteTokens != null ||
      agent.totalCents != null
    );
  }
}
