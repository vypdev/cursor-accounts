import {
  resolveProfileIdFromAuthorizationHeader,
} from './jwtProfileResolver';
import type { ProxyTrafficSummary } from './types';

export interface ProxyTrafficSessionCoordinatorCallbacks {
  onTraffic(summary: ProxyTrafficSummary): void;
}

/** Correlates agent traffic sessions with model, conversation, and profile context. */
export class ProxyTrafficSessionCoordinator {
  private readonly sessionModelIds = new Map<string, string>();
  private readonly sessionConversationIds = new Map<string, string>();
  private readonly sessionProfileIds = new Map<string, string>();
  private userIdToProfileId: Map<string, string> | undefined;

  constructor(
    private readonly callbacks: ProxyTrafficSessionCoordinatorCallbacks,
    userIdToProfileId?: Map<string, string>
  ) {
    this.userIdToProfileId = userIdToProfileId;
  }

  setUserIdToProfileId(mapping: Map<string, string> | undefined): void {
    this.userIdToProfileId = mapping;
  }

  resolveModelId(bidiRequestId: string | undefined): string | undefined {
    return bidiRequestId ? this.sessionModelIds.get(bidiRequestId) : undefined;
  }

  resolveConversationId(bidiRequestId: string | undefined): string | undefined {
    return bidiRequestId
      ? this.sessionConversationIds.get(bidiRequestId)
      : undefined;
  }

  dispatch(summary: ProxyTrafficSummary, headers?: Record<string, string>): void {
    const enriched = this.enrich(summary, headers);
    this.trackSessionModel(enriched);
    this.trackSessionConversation(enriched);
    this.trackSessionProfile(enriched);
    this.callbacks.onTraffic(enriched);
  }

  track(summary: ProxyTrafficSummary): void {
    this.trackSessionModel(summary);
    this.trackSessionConversation(summary);
  }

  clear(): void {
    this.sessionModelIds.clear();
    this.sessionConversationIds.clear();
    this.sessionProfileIds.clear();
  }

  private trackSessionModel(summary: ProxyTrafficSummary): void {
    const agent = summary.insights?.agent;
    const modelId = agent?.requestedModelId ?? agent?.modelName;
    const sessionId = agent?.requestId;
    if (modelId && sessionId) {
      this.sessionModelIds.set(sessionId, modelId);
    }
  }

  private trackSessionConversation(summary: ProxyTrafficSummary): void {
    const agent = summary.insights?.agent;
    const conversationId =
      agent?.conversationId ?? summary.insights?.context?.conversationId;
    const sessionId = agent?.requestId;
    if (conversationId && sessionId) {
      this.sessionConversationIds.set(sessionId, conversationId);
    }
  }

  private trackSessionProfile(summary: ProxyTrafficSummary): void {
    const agent = summary.insights?.agent;
    const sessionId = agent?.requestId;
    if (summary.profileId && sessionId) {
      this.sessionProfileIds.set(sessionId, summary.profileId);
    }
  }

  private enrich(
    summary: ProxyTrafficSummary,
    headers?: Record<string, string>
  ): ProxyTrafficSummary {
    if (!summary.insights?.agent) {
      return summary;
    }

    const profileId =
      (headers
        ? resolveProfileIdFromAuthorizationHeader(
            headers,
            this.userIdToProfileId
          )
        : undefined) ??
      (summary.insights.agent.requestId
        ? this.sessionProfileIds.get(summary.insights.agent.requestId)
        : undefined);

    const workspaceId =
      summary.insights.workspace?.workspaceId ?? summary.workspaceId;

    if (!profileId && !workspaceId) {
      return summary;
    }

    return {
      ...summary,
      profileId: profileId ?? summary.profileId,
      workspaceId: workspaceId ?? summary.workspaceId,
    };
  }
}
