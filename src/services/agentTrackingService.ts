import type { IAgentTrackingRepository } from '../domain/ports/IAgentTrackingRepository';
import type { ITokenTurnDetectionService } from '../domain/ports/ITokenTurnDetectionService';
import type { AgentTokenType } from '../persistence/types';
import type { ProxyTrafficSummary } from '../proxy/types';
import type { AgentSessionInfo } from '../proxy/proxyInsightExtractor';
import * as extensionLog from '../logging/extensionLog';

/**
 * Application service for persisting agent traffic to the tracking repository.
 */
export class AgentTrackingService {
  constructor(
    private readonly repository: IAgentTrackingRepository,
    private readonly profileId: string,
    private readonly turnDetectionService?: ITokenTurnDetectionService
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

  async ingestTraffic(summary: ProxyTrafficSummary): Promise<void> {
    try {
      const insights = summary.insights;
      if (!insights) {
        return;
      }

      const timestamp = this.normalizeTimestamp(summary.timestamp);
      const conversationId =
        insights.agent?.conversationId ?? insights.context?.conversationId;

      if (!conversationId) {
        return;
      }

      await this.repository.upsertConversation(
        conversationId,
        this.profileId,
        timestamp,
        insights.context?.messageCount
      );

      const agent = insights.agent;
      if (!agent?.requestId) {
        return;
      }

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
      });

      const allTokenFrames = insights.allTokenFrames;
      const httpRequestId = summary.httpRequestId;
      const modelName = insights.tokens?.modelName ?? agent.modelName;

      if (
        allTokenFrames &&
        allTokenFrames.length > 0 &&
        this.turnDetectionService
      ) {
        const turns = this.turnDetectionService.detectTurns(allTokenFrames);
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

      if (agent.usageEvent && this.hasTokenData(agent)) {
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
      }
    } catch (error) {
      extensionLog.error(
        `[AgentTracking] Ingestion error: ${extensionLog.formatError(error)}`
      );
    }
  }

  getConversationTokens(conversationId: string) {
    return this.repository.getTotalConversationTokens(conversationId);
  }

  getAgentTokens(requestId: string) {
    return this.repository.getAgentTokens(requestId);
  }

  getAgentTree(conversationId: string) {
    return this.repository.getAgentTree(conversationId);
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
