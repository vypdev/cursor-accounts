import type { ConversationTokenTotals } from '../types/agentPersistence';
import type { ProxyTrafficSummary } from '../types/proxyTraffic';

export type ProxyTrafficListener = (summary: ProxyTrafficSummary) => void;

export interface ConversationUsagePersistedEvent {
  conversationId: string;
  profileId: string;
}

export type ConversationUsagePersistedListener = (
  event: ConversationUsagePersistedEvent
) => void;

/** Narrow read model used by the active-conversation status bar. */
export interface IAgentTokenReader {
  getConversationTokens(conversationId: string): Promise<ConversationTokenTotals>;
}

/** Traffic callbacks and conversation-scoped tracking access used by activation. */
export interface IProxyTraffic {
  onTraffic(listener: ProxyTrafficListener): void;
  onConversationUsagePersisted(listener: ConversationUsagePersistedListener): void;
  getAgentTrackingService(profileId: string): IAgentTokenReader | undefined;
}
