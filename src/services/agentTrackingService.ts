import type { IngestTrafficResult } from '../application/types/agentPersistence';
import { AgentTrackingPersistenceCoordinator } from '../application/services/agentTrackingPersistenceCoordinator';
import type { AgentSessionInfo } from '../application/types/agentTracking';
import type { ProxyTrafficSummary } from '../application/types/proxyTraffic';
import type { IAgentTrackingRepository } from '../domain/ports/IAgentTrackingRepository';
import type { IProxyLiveCostCalculator } from '../domain/ports/IProxyLiveCostCalculator';
import type { ITokenTurnDetectionService } from '../domain/ports/ITokenTurnDetectionService';
import * as extensionLog from '../logging/extensionLog';

const TRACKING_LOG = '[AgentTracking]';

function shortId(id?: string): string {
  return id ? `${id.slice(0, 8)}…` : '(none)';
}

/** Application orchestrator for profile and conversation-scoped agent tracking. */
export class AgentTrackingService {
  private readonly persistence: AgentTrackingPersistenceCoordinator;

  constructor(
    private readonly repository: IAgentTrackingRepository,
    private readonly profileId: string,
    turnDetectionService?: ITokenTurnDetectionService,
    costCalculator?: IProxyLiveCostCalculator
  ) {
    this.persistence = new AgentTrackingPersistenceCoordinator(
      repository,
      turnDetectionService,
      costCalculator
    );
  }

  async initialize(): Promise<void> {
    try {
      await this.repository.initialize();
      extensionLog.info(`${TRACKING_LOG} Initialized successfully`);
    } catch (error) {
      extensionLog.error(
        `${TRACKING_LOG} Initialization failed: ${extensionLog.formatError(error)}`
      );
      throw error;
    }
  }

  async ingestTraffic(
    summary: ProxyTrafficSummary
  ): Promise<IngestTrafficResult | void> {
    const ingestKind = summary.isLiveTokenUpdate
      ? 'live'
      : summary.isTurnEnded
        ? 'turn_ended'
        : 'batch';

    try {
      const insights = summary.insights;
      if (!insights) {
        extensionLog.info(`${TRACKING_LOG} skip (${ingestKind}): no insights`);
        return;
      }

      const agent = insights.agent;
      if (!agent?.requestId) {
        extensionLog.info(
          `${TRACKING_LOG} skip (${ingestKind}): missing agent.requestId ` +
            `http=${shortId(summary.httpRequestId)} usage=${agent?.usageEvent ?? '(none)'}`
        );
        return;
      }

      const timestamp = this.normalizeTimestamp(summary.timestamp);
      const conversationId = await this.resolveConversationId(agent);
      if (!conversationId) {
        extensionLog.info(
          `${TRACKING_LOG} skip (${ingestKind}): missing conversationId ` +
            `bidi=${shortId(agent.requestId)} usage=${agent.usageEvent ?? '(none)'}`
        );
        return;
      }

      const effectiveProfileId = summary.profileId ?? this.profileId;
      const modelName = insights.tokens?.modelName ?? agent.modelName;

      await this.repository.upsertConversation(
        conversationId,
        effectiveProfileId,
        timestamp,
        insights.context?.messageCount
      );
      await this.repository.upsertAgent({
        requestId: agent.requestId,
        conversationId,
        conversationGroupId: agent.conversationGroupId,
        parentRequestId: agent.parentRequestId,
        subagentRequestId: agent.subagentRequestId,
        modelName,
        startedAt: timestamp,
        endedAt: agent.eof ? timestamp : undefined,
        isEof: agent.eof ?? false,
        profileId: effectiveProfileId,
      });

      const persisted = await this.persistence.persist({
        summary,
        insights,
        agent,
        timestamp,
        modelName,
      });

      if (!persisted.persisted) {
        extensionLog.info(
          `${TRACKING_LOG} no persistence path (${persisted.kind}) ` +
            `bidi=${shortId(agent.requestId)} conv=${shortId(conversationId)}`
        );
        return;
      }

      extensionLog.info(
        `${TRACKING_LOG} persisted ${persisted.kind} ` +
          `bidi=${shortId(agent.requestId)} conv=${shortId(conversationId)}`
      );

      if (persisted.kind === 'turn_ended') {
        return {
          conversationId,
          deltaPersisted: false,
          turnEndedPersisted: true,
          contextPersisted: false,
        };
      }

      if (persisted.kind === 'context') {
        return {
          conversationId,
          deltaPersisted: false,
          turnEndedPersisted: false,
          contextPersisted: true,
        };
      }

      if (persisted.kind === 'live_delta' || persisted.kind === 'batch') {
        return {
          conversationId,
          deltaPersisted: true,
          turnEndedPersisted: false,
          contextPersisted: this.persistence.hasPersistableContext(agent),
        };
      }
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

  private async resolveConversationId(agent: AgentSessionInfo): Promise<string | undefined> {
    if (agent.conversationId) return agent.conversationId;
    const existingAgent = await this.repository.getAgentTokens(agent.requestId!);
    return existingAgent?.conversationId;
  }

  private normalizeTimestamp(isoTimestamp: string): number {
    const parsed = Date.parse(isoTimestamp);
    return Number.isFinite(parsed)
      ? Math.floor(parsed / 1000)
      : Math.floor(Date.now() / 1000);
  }
}
