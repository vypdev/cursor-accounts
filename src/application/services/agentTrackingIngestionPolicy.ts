import type { IngestTrafficResult } from '../types/agentPersistence';
import type { AgentPersistenceEventKind } from './agentTrackingPersistenceTypes';
import type { AgentSessionInfo } from '../types/agentTracking';
import type { ProxyInsights } from '../types/proxyInsights';
import type { ProxyTrafficUsageEvent } from '../../domain/types/proxyTraffic';

export type AgentIngestionKind = 'live' | 'turn_ended' | 'batch';

/** Classify an event for diagnostics without changing persistence precedence. */
export function classifyAgentIngestion(
  summary: ProxyTrafficUsageEvent
): AgentIngestionKind {
  if (summary.isLiveTokenUpdate === true) {
    return 'live';
  }
  if (summary.isTurnEnded === true) {
    return 'turn_ended';
  }
  return 'batch';
}

/** Normalize an ISO timestamp to Unix seconds with an explicit clock fallback. */
export function normalizeAgentTimestamp(
  isoTimestamp: string,
  fallbackSeconds: number
): number {
  const parsed = Date.parse(isoTimestamp);
  return Number.isFinite(parsed)
    ? Math.floor(parsed / 1000)
    : Math.floor(fallbackSeconds);
}

/** Preserve the token-level model identity when it is more specific. */
export function selectAgentModelName(
  insights: ProxyInsights,
  agent: AgentSessionInfo
): string | undefined {
  return insights.tokens?.modelName ?? agent.modelName;
}

/** Map a successful persistence strategy to the public ingestion contract. */
export function createIngestTrafficResult(
  conversationId: string,
  persistenceKind: AgentPersistenceEventKind,
  contextPersisted: boolean
): IngestTrafficResult | undefined {
  switch (persistenceKind) {
    case 'turn_ended':
      return {
        conversationId,
        deltaPersisted: false,
        turnEndedPersisted: true,
        contextPersisted: false,
      };
    case 'context':
      return {
        conversationId,
        deltaPersisted: false,
        turnEndedPersisted: false,
        contextPersisted: true,
      };
    case 'live_delta':
    case 'batch':
      return {
        conversationId,
        deltaPersisted: true,
        turnEndedPersisted: false,
        contextPersisted,
      };
    case 'snapshot':
      return undefined;
  }
}
