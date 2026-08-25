import type { HttpProtocolVersion } from '../../domain/types/httpProtocol';
import type { ProxyInsights } from './proxyInsights';

/** Incremental live-token data carried by usage events. */
export interface ProxyLiveTokenData {
  accumulatedTokens: number;
  latestDelta: number;
  /** Model id active for this stream (from BidiAppend runRequest). */
  modelId?: string;
  /** Incremental cost of latestDelta in USD cents. */
  deltaCostCents?: number;
}

/** Narrow traffic contract consumed by agent usage and persistence workflows. */
export interface ProxyTrafficCorrelationEvent {
  insights?: ProxyInsights;
  /** Profile detected from JWT Authorization header (shared proxy mode). */
  profileId?: string;
  /** Workspace detected from agent protobuf payload. */
  workspaceId?: string;
}

/** Narrow traffic contract consumed by agent usage and persistence workflows. */
export interface ProxyTrafficUsageEvent
  extends Pick<ProxyTrafficCorrelationEvent, 'insights' | 'profileId'> {
  timestamp: string;
  url: string;
  endpoint: string;
  httpRequestId?: string;
  isLiveTokenUpdate?: boolean;
  isTurnEnded?: boolean;
  liveTokenData?: ProxyLiveTokenData;
}

/** Redacted traffic event for the proxy API and output channels. */
export interface ProxyTrafficSummary
  extends ProxyTrafficUsageEvent,
    ProxyTrafficCorrelationEvent {
  kind: 'request' | 'response' | 'error';
  method?: string;
  url: string;
  host: string;
  endpoint: string;
  statusCode?: number;
  bodyBytes?: number;
  bodyKind?: 'json' | 'proto' | 'text' | 'empty';
  rpcPath?: string;
  bodyDecoded?: Record<string, unknown>;
  decodeError?: string;
  insights?: ProxyInsights;
  userAgent?: string;
  requestId?: string;
  isCursorHost?: boolean;
  durationMs?: number;
  errorKind?: string;
  errorMessage?: string;
  protocolVersion?: HttpProtocolVersion;
}

export interface MitmProxyHandlers {
  onTraffic?: (summary: ProxyTrafficSummary) => void;
  onProxyError?: (summary: ProxyTrafficSummary) => void;
}
