import type { IAgentTrackingRepository } from '../../domain/ports/IAgentTrackingRepository';
import type { IProxyLiveCostCalculator } from '../../domain/ports/IProxyLiveCostCalculator';
import type { ITokenTurnDetectionService } from '../../domain/ports/ITokenTurnDetectionService';
import type { AgentSessionInfo } from '../types/agentTracking';
import type { ProxyInsights } from '../types/proxyInsights';
import type { ProxyTrafficSummary } from '../types/proxyTraffic';

export type AgentPersistenceEventKind =
  | 'turn_ended'
  | 'context'
  | 'live_delta'
  | 'batch'
  | 'snapshot';

export interface AgentPersistenceResult {
  kind: AgentPersistenceEventKind;
  persisted: boolean;
}

export interface AgentPersistenceContext {
  summary: ProxyTrafficSummary;
  insights: ProxyInsights;
  agent: AgentSessionInfo;
  timestamp: number;
  modelName?: string;
}

/**
 * Builds repository records from normalized agent signals.
 *
 * This keeps persistence policy, event identity, minute aggregation, and
 * billing-row construction out of the profile/conversation orchestration
 * service. The repository remains the only component that knows SQL.
 */
export class AgentTrackingPersistenceCoordinator {
  constructor(
    private readonly repository: IAgentTrackingRepository,
    private readonly turnDetectionService?: ITokenTurnDetectionService,
    private readonly costCalculator?: IProxyLiveCostCalculator
  ) {}

  async persist(context: AgentPersistenceContext): Promise<AgentPersistenceResult> {
    const { summary, insights, agent, timestamp, modelName } = context;
    const requestId = agent.requestId!;

    if (summary.isTurnEnded === true || agent.usageEvent === 'turn_ended') {
      if (agent.inputTokens == null && agent.outputTokens == null) {
        return { kind: 'turn_ended', persisted: false };
      }
      await this.repository.insertTurnEnded({
        requestId,
        inputTokens: agent.inputTokens ?? 0,
        outputTokens: agent.outputTokens ?? 0,
        cacheReadTokens: agent.cacheReadTokens,
        cacheWriteTokens: agent.cacheWriteTokens,
        totalTokens: this.resolveTotalTokens(agent),
        totalCents: agent.totalCents,
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
      return { kind: 'turn_ended', persisted: true };
    }

    if (agent.usageEvent === 'token_details') {
      if (!this.hasPersistableContext(agent)) {
        return { kind: 'context', persisted: false };
      }
      await this.repository.upsertTokenDelta({
        requestId,
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
      return { kind: 'context', persisted: true };
    }

    if (summary.isLiveTokenUpdate === true) {
      const increment = summary.liveTokenData?.latestDelta ?? agent.streamingTokens;
      if (agent.usageEvent === 'token_delta' && increment != null && increment > 0) {
        await this.persistDelta(context, increment, 'live_token_delta');
        return { kind: 'live_delta', persisted: true };
      }
      if (agent.usageEvent === 'token_delta') {
        return { kind: 'live_delta', persisted: false };
      }
    }

    if (
      insights.allTokenFrames?.length &&
      this.turnDetectionService &&
      !insights.streamingTurnsAlreadyPersisted
    ) {
      const turns = this.turnDetectionService.detectTurns(insights.allTokenFrames);
      for (const turn of turns) {
        await this.repository.insertTokenSnapshot({
          requestId,
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
      return { kind: 'batch', persisted: turns.length > 0 };
    }

    if (agent.usageEvent === 'token_delta' && agent.streamingTokens != null) {
      if (agent.streamingTokens <= 0) {
        return { kind: 'batch', persisted: false };
      }
      await this.persistDelta(context, agent.streamingTokens, 'batch_token_delta');
      return { kind: 'batch', persisted: true };
    }

    if (agent.usageEvent && this.hasTokenData(agent)) {
      const totalTokens = this.resolveTotalTokens(agent, insights.tokens?.totalTokens);
      await this.repository.insertTokenSnapshot({
        requestId,
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
      return { kind: 'snapshot', persisted: true };
    }

    return { kind: 'snapshot', persisted: false };
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
}
