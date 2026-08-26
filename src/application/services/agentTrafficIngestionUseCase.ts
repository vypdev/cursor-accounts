import type { IngestTrafficResult } from '../types/agentPersistence';
import {
  classifyAgentIngestion,
  createIngestTrafficResult,
  normalizeAgentTimestamp,
  selectAgentModelName,
  type AgentIngestionKind,
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

interface PreparedAgentIngestion {
  summary: ProxyTrafficUsageEvent;
  insights: NonNullable<ProxyTrafficUsageEvent['insights']>;
  agent: AgentSessionInfo & { requestId: string };
  timestamp: number;
  conversationId: string;
  profileId: string;
  modelName?: string;
}

function shortId(id?: string): string {
  return id ? `${id.slice(0, 8)}…` : '(none)';
}

function hasRequestId(
  agent: AgentSessionInfo | undefined
): agent is AgentSessionInfo & { requestId: string } {
  return Boolean(agent?.requestId);
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
      const context = await this.prepareIngestion(summary, ingestKind);
      if (!context) return;

      await this.upsertTrackingMetadata(context);
      const persisted = await this.dependencies.persistence.persist(context);
      return this.completeIngestion(context, persisted);
    } catch (error) {
      this.dependencies.logError(
        `${TRACKING_LOG} Ingestion error: ${formatError(error)}`
      );
    }
  }

  private async prepareIngestion(
    summary: ProxyTrafficUsageEvent,
    ingestKind: AgentIngestionKind
  ): Promise<PreparedAgentIngestion | undefined> {
    const insights = summary.insights;
    if (!insights) {
      this.dependencies.logInfo(
        `${TRACKING_LOG} skip (${ingestKind}): no insights`
      );
      return;
    }

    const agent = insights.agent;
    if (!hasRequestId(agent)) {
      this.dependencies.logInfo(
        `${TRACKING_LOG} skip (${ingestKind}): missing agent.requestId ` +
          `http=${shortId(summary.httpRequestId)} usage=${agent?.usageEvent ?? '(none)'}`
      );
      return;
    }

    const conversationId = await this.resolveConversationId(agent);
    if (!conversationId) {
      this.dependencies.logInfo(
        `${TRACKING_LOG} skip (${ingestKind}): missing conversationId ` +
          `bidi=${shortId(agent.requestId)} usage=${agent.usageEvent ?? '(none)'}`
      );
      return;
    }

    return {
      summary,
      insights,
      agent,
      timestamp: normalizeAgentTimestamp(summary.timestamp, this.dependencies.now()),
      conversationId,
      profileId: summary.profileId ?? this.dependencies.profileId,
      modelName: selectAgentModelName(insights, agent),
    };
  }

  private async upsertTrackingMetadata(
    context: PreparedAgentIngestion
  ): Promise<void> {
    await this.dependencies.repository.upsertConversation(
      context.conversationId,
      context.profileId,
      context.timestamp,
      context.insights.context?.messageCount
    );
    await this.dependencies.repository.upsertAgent({
      requestId: context.agent.requestId,
      conversationId: context.conversationId,
      conversationGroupId: context.agent.conversationGroupId,
      parentRequestId: context.agent.parentRequestId,
      subagentRequestId: context.agent.subagentRequestId,
      modelName: context.modelName,
      startedAt: context.timestamp,
      endedAt: context.agent.eof ? context.timestamp : undefined,
      isEof: context.agent.eof ?? false,
      profileId: context.profileId,
    });
  }

  private completeIngestion(
    context: PreparedAgentIngestion,
    persisted: AgentPersistenceResult
  ): IngestTrafficResult | undefined {
    if (!persisted.persisted) {
      this.dependencies.logInfo(
        `${TRACKING_LOG} no persistence path (${persisted.kind}) ` +
          `bidi=${shortId(context.agent.requestId)} conv=${shortId(context.conversationId)}`
      );
      return;
    }

    this.dependencies.logInfo(
      `${TRACKING_LOG} persisted ${persisted.kind} ` +
        `bidi=${shortId(context.agent.requestId)} conv=${shortId(context.conversationId)}`
    );

    return createIngestTrafficResult(
      context.conversationId,
      persisted.kind,
      this.dependencies.persistence.hasPersistableContext(context.agent)
    );
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
