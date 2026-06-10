import type { ProxyTrafficSummary } from '../../application/types/proxyTraffic';

/** Configuration passed to an upstream analysis worker child process. */
export interface UpstreamWorkerConfig {
  upstreamId: string;
  profileId: string;
  workspacePath: string;
  userDataDir: string;
  extensionPath: string;
  useBetterSqlite3: boolean;
  estimatedDollarsPerMillionTokens: number;
}

/** Messages sent from parent to upstream worker. */
export type UpstreamWorkerParentMessage =
  | { type: 'traffic'; summary: ProxyTrafficSummary }
  | { type: 'shutdown' };

/** Messages sent from upstream worker to parent. */
export type UpstreamWorkerChildMessage =
  | { type: 'ready'; upstreamId: string }
  | { type: 'error'; message: string }
  | { type: 'traffic_ingested'; upstreamId: string; conversationId?: string };

/** Metadata tracked for each running upstream worker. */
export interface UpstreamWorkerRecord {
  id: string;
  profileId: string;
  workspacePath: string;
  healthy: boolean;
  trafficReceived: number;
  startedAt: Date;
}
