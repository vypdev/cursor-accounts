import type { ConversationUsagePersistedEvent } from '../domain/ports/IProxyTraffic';
import type { ProxyTrafficUsageEvent } from '../domain/types/proxyTraffic';
import type { AgentTrackingService } from './agentTrackingService';
import * as extensionLog from '../logging/extensionLog';
import { SHARED_PROXY_RUNTIME_KEY } from '../proxy/types';

export interface ProxyTrafficUsageCoordinatorDependencies {
  isSharedProxyActive(): boolean;
  ensureAgentTracking(profileId: string): Promise<void>;
  getAgentTrackingService(profileId: string): AgentTrackingService | undefined;
  onUsagePersisted(event: ConversationUsagePersistedEvent): void;
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
    const agent = summary.insights?.agent;
    const trafficIsAgentTraffic = isAgentTraffic(summary);

    if (trafficIsAgentTraffic) {
      extensionLog.info(
        `[AgentTracking] proxy recv profile=${effectiveProfileId ?? '(none)'} ` +
          `live=${summary.isLiveTokenUpdate === true} turnEnded=${summary.isTurnEnded === true} ` +
          `bidi=${shortId(agent?.requestId)} ` +
          `conv=${shortId(agent?.conversationId ?? summary.insights?.context?.conversationId)} ` +
          `usage=${agent?.usageEvent ?? '(none)'} ` +
          `delta=${summary.liveTokenData?.latestDelta ?? '(none)'} ` +
          `endpoint=${summary.endpoint ?? summary.url}`
      );
    }

    if (
      effectiveProfileId &&
      effectiveProfileId !== SHARED_PROXY_RUNTIME_KEY
    ) {
      if (!this.dependencies.isSharedProxyActive()) {
        await this.dependencies.ensureAgentTracking(effectiveProfileId);
        const tracking = this.dependencies.getAgentTrackingService(
          effectiveProfileId
        );
        if (!tracking && trafficIsAgentTraffic) {
          extensionLog.warn(
            `[AgentTracking] no AgentTrackingService for profile=${effectiveProfileId}`
          );
        }
        const result = await tracking?.ingestTraffic(summary);
        if (trafficIsAgentTraffic) {
          extensionLog.info(
            `[AgentTracking] ingest result profile=${effectiveProfileId} ` +
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
            profileId: effectiveProfileId,
          });
        }
      } else if (trafficIsAgentTraffic) {
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
            profileId: effectiveProfileId,
          });
        }
      }
    } else if (trafficIsAgentTraffic) {
      extensionLog.warn(
        '[AgentTracking] agent traffic without profileId — ingest skipped'
      );
    }

    return effectiveProfileId;
  }
}
