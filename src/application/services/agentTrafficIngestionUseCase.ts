import type { IngestTrafficResult } from '../types/agentPersistence';
import {
  classifyAgentIngestion,
  createIngestTrafficResult,
  normalizeAgentTimestamp,
  selectAgentModelName,
} from './agentTrackingIngestionPolicy';
import type {
  AgentPersistenceContext,
  AgentPersistenceResult,
} from './agentTrackingPersistenceTypes';
import type { AgentSessionInfo } from '../types/agentTracking';
import type { ProxyTrafficUsageEvent } from '../../domain/types/proxyTraffic';
import type { IAgentTrackingRepository } from '../../domain/ports/IAgentTrackingRepository';

const TRACKING_LOG = '[AgentTracking]';

export interface AgentTrafficIngestionUseCaseDependencies {
  repository: IAgentTrackingRepository;
  profileId: string;
  persistence: AgentTrackingPersistencePort;
  now: () => number;
  logInfo(message: string): void;
  logError(message: string): void;
}

export interface AgentTrackingPersistencePort {
  persist(context: AgentPersistenceContext): Promise<AgentPersistenceResult>;
  hasPersistableContext(agent: AgentSessionInfo): boolean;
}

function shortId(id?: string): string {
  return id ? `${id.slice(0, 8)}…` : '(none)';
}

/**
 * Ingests correlated proxy traffic into the agent-tracking persistence port.
 * Repository writes and logging are injected so this application use case is
 * independent from VS Code, filesystem, and proxy transport adapters.
 */
export class AgentTrafficIngestionUseCase {
  constructor(
    private readonly dependencies: AgentTrafficIngestionUseCaseDependencies
  ) {}

  async initialize(): Promise<void> {
    try {
      await this.dependencies.repository.initialize();
      this.dependencies.logInfo(`${TRACKING_LOG} Initialized successfully`);
    } catch (error) {
      this.dependencies.logError(
        `${TRACKING_LOG} Initialization failed: ${formatError(error)}`
      );
      throw error;
    }
  }

  async execute(
    summary: ProxyTrafficUsageEvent
  ): Promise<IngestTrafficResult | void> {
    const ingestKind = classifyAgentIngestion(summary);

    try {
      const insights = summary.insights;
      if (!insights) {
        this.dependencies.logInfo(
          `${TRACKING_LOG} skip (${ingestKind}): no insights`
        );
        return;
      }

      const agent = insights.agent;
      if (!agent?.requestId) {
        this.dependencies.logInfo(
          `${TRACKING_LOG} skip (${ingestKind}): missing agent.requestId ` +
            `http=${shortId(summary.httpRequestId)} usage=${agent?.usageEvent ?? '(none)'}`
        );
        return;
      }

      const timestamp = normalizeAgentTimestamp(summary.timestamp, this.dependencies.now());
      const conversationId = await this.resolveConversationId(agent);
      if (!conversationId) {
        this.dependencies.logInfo(
          `${TRACKING_LOG} skip (${ingestKind}): missing conversationId ` +
            `bidi=${shortId(agent.requestId)} usage=${agent.usageEvent ?? '(none)'}`
        );
        return;
      }

      const effectiveProfileId = summary.profileId ?? this.dependencies.profileId;
      const modelName = selectAgentModelName(insights, agent);

      await this.dependencies.repository.upsertConversation(
        conversationId,
        effectiveProfileId,
        timestamp,
        insights.context?.messageCount
      );
      await this.dependencies.repository.upsertAgent({
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

      const persisted = await this.dependencies.persistence.persist({
        summary,
        insights,
        agent,
        timestamp,
        modelName,
      });

      if (!persisted.persisted) {
        this.dependencies.logInfo(
          `${TRACKING_LOG} no persistence path (${persisted.kind}) ` +
            `bidi=${shortId(agent.requestId)} conv=${shortId(conversationId)}`
        );
        return;
      }

      this.dependencies.logInfo(
        `${TRACKING_LOG} persisted ${persisted.kind} ` +
          `bidi=${shortId(agent.requestId)} conv=${shortId(conversationId)}`
      );

      return createIngestTrafficResult(
        conversationId,
        persisted.kind,
        this.dependencies.persistence.hasPersistableContext(agent)
      );
    } catch (error) {
      this.dependencies.logError(
        `${TRACKING_LOG} Ingestion error: ${formatError(error)}`
      );
    }
  }

  private async resolveConversationId(
    agent: AgentSessionInfo
  ): Promise<string | undefined> {
    if (agent.conversationId) {
      return agent.conversationId;
    }
    const existingAgent = await this.dependencies.repository.getAgentTokens(
      agent.requestId!
    );
    return existingAgent?.conversationId;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
