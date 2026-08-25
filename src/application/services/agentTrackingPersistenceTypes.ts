import type { ProxyTrafficUsageEvent } from '../../domain/types/proxyTraffic';
import type { AgentSessionInfo } from '../types/agentTracking';
import type { ProxyInsights } from '../types/proxyInsights';

export type AgentPersistenceEventKind =
  | 'turn_ended'
  | 'context'
  | 'live_delta'
  | 'batch'
  | 'snapshot';

export interface AgentPersistenceResult {
  kind: AgentPersistenceEventKind;
  persisted: boolean;
}

export interface AgentPersistenceContext {
  summary: ProxyTrafficUsageEvent;
  insights: ProxyInsights;
  agent: AgentSessionInfo;
  timestamp: number;
  modelName?: string;
}
