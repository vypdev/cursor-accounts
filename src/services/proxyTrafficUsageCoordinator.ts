import type { ConversationUsagePersistedEvent } from '../domain/ports/IProxyTraffic';
import type { ProxyTrafficUsageEvent } from '../domain/types/proxyTraffic';
import type { IngestTrafficResult } from '../application/types/agentPersistence';
import { SHARED_PROXY_RUNTIME_KEY } from '../proxy/types';

export interface AgentTrafficIngestor {
  ingestTraffic(
    summary: ProxyTrafficUsageEvent
  ): Promise<IngestTrafficResult | void>;
}

export interface ProxyTrafficUsageLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface ProxyTrafficUsageCoordinatorDependencies {
  isSharedProxyActive(): boolean;
  ensureAgentTracking(profileId: string): Promise<void>;
  getAgentTrackingService(
    profileId: string
  ): AgentTrafficIngestor | undefined;
  onUsagePersisted(event: ConversationUsagePersistedEvent): void;
  logger: ProxyTrafficUsageLogger;
}

function shortId(value?: string): string {
  return value ? `${value.slice(0, 8)}…` : '(none)';
}

function isAgentTraffic(summary: ProxyTrafficUsageEvent): boolean {
  const agent = summary.insights?.agent;
  return (
    summary.isLiveTokenUpdate === true ||
    summary.isTurnEnded === true ||
    agent?.usageEvent != null ||
    (summary.insights?.allTokenFrames?.length ?? 0) > 0
  );
}

/** Coordinates traffic ingestion and persisted-usage notifications. */
export class ProxyTrafficUsageCoordinator {
  constructor(
    private readonly dependencies: ProxyTrafficUsageCoordinatorDependencies
  ) {}

  async handle(
    summary: ProxyTrafficUsageEvent,
    profileId?: string
  ): Promise<string | undefined> {
    const effectiveProfileId = summary.profileId ?? profileId;
    const trafficIsAgentTraffic = isAgentTraffic(summary);

    this.logAgentTraffic(summary, effectiveProfileId, trafficIsAgentTraffic);

    if (
      !effectiveProfileId ||
      effectiveProfileId === SHARED_PROXY_RUNTIME_KEY
    ) {
      if (trafficIsAgentTraffic) {
        this.dependencies.logger.warn(
          '[AgentTracking] agent traffic without profileId — ingest skipped'
        );
      }
      return effectiveProfileId;
    }

    if (this.dependencies.isSharedProxyActive()) {
      this.notifySharedUsage(summary, effectiveProfileId, trafficIsAgentTraffic);
    } else {
      await this.ingestProfileTraffic(
        summary,
        effectiveProfileId,
        trafficIsAgentTraffic
      );
    }
    return effectiveProfileId;
  }

  private logAgentTraffic(
    summary: ProxyTrafficUsageEvent,
    profileId: string | undefined,
    trafficIsAgentTraffic: boolean
  ): void {
    if (!trafficIsAgentTraffic) return;

    const agent = summary.insights?.agent;
    this.dependencies.logger.info(
      `[AgentTracking] proxy recv profile=${profileId ?? '(none)'} ` +
        `live=${summary.isLiveTokenUpdate === true} turnEnded=${summary.isTurnEnded === true} ` +
        `bidi=${shortId(agent?.requestId)} ` +
        `conv=${shortId(agent?.conversationId ?? summary.insights?.context?.conversationId)} ` +
        `usage=${agent?.usageEvent ?? '(none)'} ` +
        `delta=${summary.liveTokenData?.latestDelta ?? '(none)'} ` +
        `endpoint=${summary.endpoint ?? summary.url}`
    );
  }

  private async ingestProfileTraffic(
    summary: ProxyTrafficUsageEvent,
    profileId: string,
    trafficIsAgentTraffic: boolean
  ): Promise<void> {
    await this.dependencies.ensureAgentTracking(profileId);
    const tracking = this.dependencies.getAgentTrackingService(profileId);
    if (!tracking && trafficIsAgentTraffic) {
      this.dependencies.logger.warn(
        `[AgentTracking] no AgentTrackingService for profile=${profileId}`
      );
    }

    const result = await tracking?.ingestTraffic(summary);
    if (trafficIsAgentTraffic) {
      this.dependencies.logger.info(
        `[AgentTracking] ingest result profile=${profileId} ` +
          `delta=${result?.deltaPersisted === true} ` +
          `turnEnded=${result?.turnEndedPersisted === true} ` +
          `context=${result?.contextPersisted === true} ` +
          `conv=${shortId(result?.conversationId)}`
      );
    }

    if (
      result &&
      (result.deltaPersisted ||
        result.turnEndedPersisted ||
        result.contextPersisted)
    ) {
      this.dependencies.onUsagePersisted({
        conversationId: result.conversationId,
        profileId,
      });
    }
  }

  private notifySharedUsage(
    summary: ProxyTrafficUsageEvent,
    profileId: string,
    trafficIsAgentTraffic: boolean
  ): void {
    if (!trafficIsAgentTraffic) return;

    const agent = summary.insights?.agent;
    const conversationId =
      agent?.conversationId ?? summary.insights?.context?.conversationId;
    if (
      conversationId &&
      (summary.isLiveTokenUpdate ||
        summary.isTurnEnded ||
        agent?.usageEvent === 'token_details')
    ) {
      this.dependencies.onUsagePersisted({
        conversationId,
        profileId,
      });
    }
  }
}
