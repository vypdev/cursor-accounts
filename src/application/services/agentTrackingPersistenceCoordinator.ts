import type { IAgentTrackingRepository } from '../../domain/ports/IAgentTrackingRepository';
import type { IProxyLiveCostCalculator } from '../../domain/ports/IProxyLiveCostCalculator';
import type { ITokenTurnDetectionService } from '../../domain/ports/ITokenTurnDetectionService';
import type { AgentSessionInfo } from '../types/agentTracking';
import { AgentTrackingPersistenceWriter } from './agentTrackingPersistenceWriter';
import type {
  AgentPersistenceContext,
  AgentPersistenceResult,
} from './agentTrackingPersistenceTypes';

export type {
  AgentPersistenceContext,
  AgentPersistenceEventKind,
  AgentPersistenceResult,
} from './agentTrackingPersistenceTypes';

/**
 * Selects the first applicable persistence strategy for normalized agent
 * signals. Record construction and repository writes live in the writer.
 */
export class AgentTrackingPersistenceCoordinator {
  private readonly writer: AgentTrackingPersistenceWriter;

  constructor(
    repository: IAgentTrackingRepository,
    turnDetectionService?: ITokenTurnDetectionService,
    costCalculator?: IProxyLiveCostCalculator
  ) {
    this.writer = new AgentTrackingPersistenceWriter(
      repository,
      turnDetectionService,
      costCalculator
    );
  }

  async persist(context: AgentPersistenceContext): Promise<AgentPersistenceResult> {
    const { summary, agent } = context;

    if (summary.isTurnEnded === true || agent.usageEvent === 'turn_ended') {
      return {
        kind: 'turn_ended',
        persisted: await this.writer.writeTurnEnded(context),
      };
    }

    if (agent.usageEvent === 'token_details') {
      return {
        kind: 'context',
        persisted: await this.writer.writeContext(context),
      };
    }

    const liveResult = await this.writer.writeLiveDelta(context);
    if (liveResult !== undefined) {
      return { kind: 'live_delta', persisted: liveResult };
    }

    const detectedTurnsResult = await this.writer.writeDetectedTurns(context);
    if (detectedTurnsResult !== undefined) {
      return { kind: 'batch', persisted: detectedTurnsResult };
    }

    const batchResult = await this.writer.writeBatchDelta(context);
    if (batchResult !== undefined) {
      return { kind: 'batch', persisted: batchResult };
    }

    return {
      kind: 'snapshot',
      persisted: await this.writer.writeSnapshot(context),
    };
  }

  hasPersistableContext(agent: AgentSessionInfo): boolean {
    return this.writer.hasPersistableContext(agent);
  }
}
