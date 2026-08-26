import type { IngestTrafficResult } from '../application/types/agentPersistence';
import { AgentTrafficIngestionUseCase } from '../application/services/agentTrafficIngestionUseCase';
import { AgentTrackingPersistenceCoordinator } from '../application/services/agentTrackingPersistenceCoordinator';
import type { ProxyTrafficUsageEvent } from '../domain/types/proxyTraffic';
import type { IAgentTrackingRepository } from '../domain/ports/IAgentTrackingRepository';
import type { IProxyLiveCostCalculator } from '../domain/ports/IProxyLiveCostCalculator';
import type { ITokenTurnDetectionService } from '../domain/ports/ITokenTurnDetectionService';
import * as extensionLog from '../logging/extensionLog';

/** Application orchestrator for profile and conversation-scoped agent tracking. */
export class AgentTrackingService {
  private readonly persistence: AgentTrackingPersistenceCoordinator;
  private readonly ingestion: AgentTrafficIngestionUseCase;

  constructor(
    private readonly repository: IAgentTrackingRepository,
    profileId: string,
    turnDetectionService?: ITokenTurnDetectionService,
    costCalculator?: IProxyLiveCostCalculator,
    now: () => number = () => Date.now() / 1000
  ) {
    this.persistence = new AgentTrackingPersistenceCoordinator(
      repository,
      turnDetectionService,
      costCalculator
    );
    this.ingestion = new AgentTrafficIngestionUseCase({
      repository,
      profileId,
      persistence: this.persistence,
      now,
      logInfo: (message) => extensionLog.info(message),
      logError: (message) => extensionLog.error(message),
    });
  }

  async initialize(): Promise<void> {
    return this.ingestion.initialize();
  }

  async ingestTraffic(
    summary: ProxyTrafficUsageEvent
  ): Promise<IngestTrafficResult | void> {
    return this.ingestion.execute(summary);
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

}
