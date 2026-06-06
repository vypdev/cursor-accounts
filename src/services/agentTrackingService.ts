import type { IngestTrafficResult } from '../application/types/agentPersistence';
import { extractGitInfo } from '../utils/gitWorkspaceExtractor';
import type { IAgentTrackingRepository } from '../domain/ports/IAgentTrackingRepository';
import type { IProxyLiveCostCalculator } from '../domain/ports/IProxyLiveCostCalculator';
import type { ITokenTurnDetectionService } from '../domain/ports/ITokenTurnDetectionService';
import type { AgentTokenType } from '../persistence/types';
import type { ProxyTrafficSummary } from '../proxy/types';
import type { AgentSessionInfo } from '../proxy/proxyInsightExtractor';
import * as extensionLog from '../logging/extensionLog';

const TRACKING_LOG = '[AgentTracking]';

function shortId(id?: string): string {
  return id ? `${id.slice(0, 8)}…` : '(none)';
}

/**
 * Application service for persisting agent traffic to the tracking repository.
 */
export class AgentTrackingService {
  constructor(
    private readonly repository: IAgentTrackingRepository,
    private readonly profileId: string,
    private readonly turnDetectionService?: ITokenTurnDetectionService,
    private readonly costCalculator?: IProxyLiveCostCalculator
  ) {}

  async initialize(): Promise<void> {
    try {
      await this.repository.initialize();
      extensionLog.info('[AgentTracking] Initialized successfully');
    } catch (error) {
      extensionLog.error(
        `[AgentTracking] Initialization failed: ${extensionLog.formatError(error)}`
      );
      throw error;
    }
  }

  async ingestTraffic(
    summary: ProxyTrafficSummary,
    workspacePath?: string
  ): Promise<IngestTrafficResult | void> {
    const ingestKind = summary.isLiveTokenUpdate
      ? 'live'
      : summary.isTurnEnded
        ? 'turn_ended'
        : 'batch';
    try {
      const insights = summary.insights;
      if (!insights) {
        extensionLog.info(
          `${TRACKING_LOG} skip (${ingestKind}): no insights endpoint=${summary.endpoint ?? summary.url}`
        );
        return;
      }

      const timestamp = this.normalizeTimestamp(summary.timestamp);
      const agent = insights.agent;
      if (!agent?.requestId) {
        extensionLog.info(
          `${TRACKING_LOG} skip (${ingestKind}): missing agent.requestId ` +
            `http=${shortId(summary.httpRequestId)} ` +
            `usage=${agent?.usageEvent ?? '(none)'} ` +
            `conv=${shortId(agent?.conversationId ?? insights.context?.conversationId)} ` +
            `liveDelta=${summary.liveTokenData?.latestDelta ?? '(none)'}`
        );
        return;
      }

      let conversationId =
        agent.conversationId ?? insights.context?.conversationId;

      if (!conversationId) {
        const existingAgent = await this.repository.getAgentTokens(
          agent.requestId
        );
        conversationId = existingAgent?.conversationId;
      }

      if (!conversationId) {
        extensionLog.info(
          `${TRACKING_LOG} skip (${ingestKind}): missing conversationId ` +
            `bidi=${shortId(agent.requestId)} usage=${agent.usageEvent ?? '(none)'}`
        );
        return;
      }

      const gitInfo = workspacePath
        ? await extractGitInfo(workspacePath)
        : null;

      await this.repository.upsertConversation(
        conversationId,
        this.profileId,
        timestamp,
        insights.context?.messageCount,
        workspacePath,
        gitInfo?.repositoryPath,
        gitInfo?.branchName ?? undefined
      );

      await this.repository.upsertAgent({
        requestId: agent.requestId,
        conversationId,
        conversationGroupId: agent.conversationGroupId,
        parentRequestId: agent.parentRequestId,
        subagentRequestId: agent.subagentRequestId,
        modelName: insights.tokens?.modelName ?? agent.modelName,
        startedAt: timestamp,
        endedAt: agent.eof ? timestamp : undefined,
        isEof: agent.eof ?? false,
        profileId: this.profileId,
        workspacePath,
        repositoryPath: gitInfo?.repositoryPath,
        branchName: gitInfo?.branchName ?? undefined,
      });

      const httpRequestId = summary.httpRequestId;
      const modelName = insights.tokens?.modelName ?? agent.modelName;

      if (this.isTurnEndedEvent(summary, agent)) {
        const turnEndedPersisted = await this.persistTurnEnded(
          agent,
          timestamp,
          modelName,
          httpRequestId
        );
        if (turnEndedPersisted) {
          extensionLog.info(
            `${TRACKING_LOG} persisted turn_ended bidi=${shortId(agent.requestId)} conv=${shortId(conversationId)}`
          );
          return {
            conversationId,
            deltaPersisted: false,
            turnEndedPersisted: true,
            contextPersisted: false,
          };
        }
        extensionLog.info(
          `${TRACKING_LOG} skip turn_ended: no input/output tokens bidi=${shortId(agent.requestId)}`
        );
        return;
      }

      if (this.isContextSnapshotEvent(agent)) {
        const contextPersisted = await this.persistContextSnapshot(
          agent,
          timestamp,
          modelName
        );
        if (contextPersisted) {
          extensionLog.info(
            `${TRACKING_LOG} persisted context snapshot bidi=${shortId(agent.requestId)} conv=${shortId(conversationId)}`
          );
          return {
            conversationId,
            deltaPersisted: false,
            turnEndedPersisted: false,
            contextPersisted: true,
          };
        }
        extensionLog.info(
          `${TRACKING_LOG} skip token_details: no persistable context bidi=${shortId(agent.requestId)}`
        );
        return;
      }

      if (summary.isLiveTokenUpdate) {
        extensionLog.info(
          `${TRACKING_LOG} live token_delta attempt bidi=${shortId(agent.requestId)} ` +
            `conv=${shortId(conversationId)} usage=${agent.usageEvent ?? '(none)'} ` +
            `latestDelta=${summary.liveTokenData?.latestDelta ?? '(none)'} ` +
            `accumulated=${summary.liveTokenData?.accumulatedTokens ?? '(none)'}`
        );
        const deltaPersisted = await this.persistLiveTokenDelta(
          summary,
          agent,
          timestamp,
          modelName
        );
        if (deltaPersisted) {
          extensionLog.info(
            `${TRACKING_LOG} persisted live token_delta bidi=${shortId(agent.requestId)} conv=${shortId(conversationId)}`
          );
          return {
            conversationId,
            deltaPersisted: true,
            turnEndedPersisted: false,
            contextPersisted: this.hasPersistableContext(agent),
          };
        }
        extensionLog.info(
          `${TRACKING_LOG} live token_delta NOT persisted bidi=${shortId(agent.requestId)} ` +
            `usage=${agent.usageEvent ?? '(none)'} ` +
            `latestDelta=${summary.liveTokenData?.latestDelta ?? agent.streamingTokens ?? '(none)'}`
        );
        if (agent.usageEvent === 'token_delta') {
          return;
        }
      }

      const allTokenFrames = insights.allTokenFrames;

      if (
        allTokenFrames &&
        allTokenFrames.length > 0 &&
        this.turnDetectionService &&
        !insights.streamingTurnsAlreadyPersisted
      ) {
        const turns = this.turnDetectionService.detectTurns(allTokenFrames);
        extensionLog.info(
          `${TRACKING_LOG} batch allTokenFrames bidi=${shortId(agent.requestId)} ` +
            `frames=${allTokenFrames.length} turns=${turns.length}`
        );
        for (const turn of turns) {
          await this.repository.insertTokenSnapshot({
            requestId: agent.requestId,
            tokenType: 'delta',
            streamingTokens: turn.streamingTokens,
            totalTokens: turn.streamingTokens,
            recordedAt: timestamp,
            modelName,
            turnIndex: turn.turnIndex,
            httpRequestId,
          });
        }
        return;
      }

      if (agent.usageEvent === 'token_delta' && agent.streamingTokens != null) {
        if (agent.streamingTokens > 0) {
          extensionLog.info(
            `${TRACKING_LOG} batch token_delta attempt bidi=${shortId(agent.requestId)} ` +
              `streamingTokens=${agent.streamingTokens} ` +
              `streamingTurnsAlreadyPersisted=${insights.streamingTurnsAlreadyPersisted === true}`
          );
          await this.persistTokenDeltaMinuteBucket({
            summary,
            agent,
            timestamp,
            increment: agent.streamingTokens,
            modelName,
          });
          extensionLog.info(
            `${TRACKING_LOG} persisted batch token_delta bidi=${shortId(agent.requestId)} conv=${shortId(conversationId)}`
          );
          return {
            conversationId,
            deltaPersisted: true,
            turnEndedPersisted: false,
            contextPersisted: this.hasPersistableContext(agent),
          };
        }
        extensionLog.info(
          `${TRACKING_LOG} skip batch token_delta: streamingTokens<=0 bidi=${shortId(agent.requestId)}`
        );
        return;
      }

      if (agent.usageEvent && this.hasTokenData(agent)) {
        extensionLog.info(
          `${TRACKING_LOG} insertTokenSnapshot usage=${agent.usageEvent} bidi=${shortId(agent.requestId)}`
        );
        await this.repository.insertTokenSnapshot({
          requestId: agent.requestId,
          tokenType: this.mapTokenType(agent.usageEvent),
          streamingTokens: agent.streamingTokens,
          inputTokens: agent.inputTokens,
          outputTokens: agent.outputTokens,
          cacheReadTokens: agent.cacheReadTokens,
          cacheWriteTokens: agent.cacheWriteTokens,
          totalTokens: this.resolveTotalTokens(agent, insights.tokens?.totalTokens),
          usageUuid: agent.usageUuid,
          recordedAt: timestamp,
          modelName,
          httpRequestId,
        });
        return;
      }

      extensionLog.info(
        `${TRACKING_LOG} ingest done with no persist path (${ingestKind}) ` +
          `bidi=${shortId(agent.requestId)} conv=${shortId(conversationId)} ` +
          `usage=${agent.usageEvent ?? '(none)'} ` +
          `isLive=${summary.isLiveTokenUpdate === true} ` +
          `allTokenFrames=${insights.allTokenFrames?.length ?? 0} ` +
          `streamingTurnsAlreadyPersisted=${insights.streamingTurnsAlreadyPersisted === true}`
      );
    } catch (error) {
      extensionLog.error(
        `${TRACKING_LOG} Ingestion error: ${extensionLog.formatError(error)}`
      );
    }
  }

  getConversationTokens(conversationId: string) {
    return this.repository.getTotalConversationTokens(conversationId);
  }

  getConversationDeltaTokens(conversationId: string) {
    return this.repository.getTotalDeltaTokensByConversation(conversationId);
  }

  getConversationTurnEnded(conversationId: string) {
    return this.repository.getTurnEndedByConversation(conversationId);
  }

  getAgentTokens(requestId: string) {
    return this.repository.getAgentTokens(requestId);
  }

  getAgentTree(conversationId: string) {
    return this.repository.getAgentTree(conversationId);
  }

  private isTurnEndedEvent(
    summary: ProxyTrafficSummary,
    agent: AgentSessionInfo
  ): boolean {
    return summary.isTurnEnded === true || agent.usageEvent === 'turn_ended';
  }

  private async persistTurnEnded(
    agent: AgentSessionInfo,
    timestamp: number,
    modelName: string | undefined,
    httpRequestId: string | undefined
  ): Promise<boolean> {
    if (agent.inputTokens == null && agent.outputTokens == null) {
      return false;
    }

    await this.repository.insertTurnEnded({
      requestId: agent.requestId!,
      inputTokens: agent.inputTokens ?? 0,
      outputTokens: agent.outputTokens ?? 0,
      cacheReadTokens: agent.cacheReadTokens,
      cacheWriteTokens: agent.cacheWriteTokens,
      totalTokens: this.resolveTotalTokens(agent),
      totalCents: agent.totalCents,
      usageUuid: agent.usageUuid,
      recordedAt: timestamp,
      modelName,
      httpRequestId,
    });
    return true;
  }

  private async persistLiveTokenDelta(
    summary: ProxyTrafficSummary,
    agent: AgentSessionInfo,
    timestamp: number,
    modelName: string | undefined
  ): Promise<boolean> {
    if (agent.usageEvent !== 'token_delta') {
      return false;
    }

    const increment =
      summary.liveTokenData?.latestDelta ?? agent.streamingTokens;
    if (increment == null || increment <= 0) {
      return false;
    }

    await this.persistTokenDeltaMinuteBucket({
      summary,
      agent,
      timestamp,
      increment,
      modelName,
    });
    return true;
  }

  private async persistTokenDeltaMinuteBucket(params: {
    summary: ProxyTrafficSummary;
    agent: AgentSessionInfo;
    timestamp: number;
    increment: number;
    modelName: string | undefined;
  }): Promise<void> {
    const { summary, agent, timestamp, increment, modelName } = params;
    const costCents = this.resolveDeltaCostCents(
      summary,
      agent,
      increment,
      modelName
    );

    const minuteBucket = this.truncateToMinuteBucket(timestamp);
    extensionLog.info(
      `${TRACKING_LOG} upsertTokenDelta bidi=${shortId(agent.requestId)} ` +
        `bucket=${minuteBucket} increment=${increment} costCents=${costCents > 0 ? costCents : 0}`
    );
    await this.repository.upsertTokenDelta({
      requestId: agent.requestId!,
      minuteBucket,
      streamingTokens: increment,
      costCents: costCents > 0 ? costCents : undefined,
      contextUsedTokens: agent.contextUsedTokens,
      contextMaxTokens: agent.maxTokens,
      recordedAt: timestamp,
      modelName,
    });
  }

  private async persistContextSnapshot(
    agent: AgentSessionInfo,
    timestamp: number,
    modelName: string | undefined
  ): Promise<boolean> {
    if (!this.hasPersistableContext(agent)) {
      return false;
    }

    await this.repository.upsertTokenDelta({
      requestId: agent.requestId!,
      minuteBucket: this.truncateToMinuteBucket(timestamp),
      streamingTokens: 0,
      contextUsedTokens: agent.contextUsedTokens,
      contextMaxTokens: agent.maxTokens,
      recordedAt: timestamp,
      modelName,
    });
    return true;
  }

  private isContextSnapshotEvent(agent: AgentSessionInfo): boolean {
    return agent.usageEvent === 'token_details';
  }

  private hasPersistableContext(agent: AgentSessionInfo): boolean {
    return (
      agent.contextUsedTokens != null &&
      agent.maxTokens != null &&
      agent.maxTokens > 0
    );
  }

  private resolveDeltaCostCents(
    summary: ProxyTrafficSummary,
    agent: AgentSessionInfo,
    increment: number,
    modelName: string | undefined
  ): number {
    const precomputed = summary.liveTokenData?.deltaCostCents;
    if (precomputed != null && precomputed > 0) {
      return precomputed;
    }
    if (!this.costCalculator) {
      return 0;
    }

    const modelId =
      summary.liveTokenData?.modelId ??
      agent.requestedModelId ??
      agent.modelName ??
      modelName;

    return this.costCalculator.calculateDeltaCost(increment, modelId);
  }

  private truncateToMinuteBucket(timestamp: number): number {
    return Math.floor(timestamp / 60) * 60;
  }

  private normalizeTimestamp(isoTimestamp: string): number {
    const parsed = Date.parse(isoTimestamp);
    if (!Number.isFinite(parsed)) {
      return Math.floor(Date.now() / 1000);
    }
    return Math.floor(parsed / 1000);
  }

  private mapTokenType(
    usageEvent: NonNullable<AgentSessionInfo['usageEvent']>
  ): AgentTokenType {
    if (usageEvent === 'turn_ended') {
      return 'turn_ended';
    }
    if (usageEvent === 'token_delta') {
      return 'delta';
    }
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

  private resolveTotalTokens(
    agent: AgentSessionInfo,
    tokenTotal?: number
  ): number | undefined {
    if (tokenTotal != null) {
      return tokenTotal;
    }
    const billed =
      (agent.inputTokens ?? 0) +
      (agent.outputTokens ?? 0) +
      (agent.cacheReadTokens ?? 0) +
      (agent.cacheWriteTokens ?? 0);
    if (billed > 0) {
      return billed;
    }
    return agent.streamingTokens;
  }
}
