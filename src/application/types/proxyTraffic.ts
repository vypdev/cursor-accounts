import type { HttpProtocolVersion } from '../../domain/types/httpProtocol';
import type { ProxyInsights } from './proxyInsights';

/** Redacted traffic event for the proxy API and output channels. */
export interface ProxyTrafficSummary {
  timestamp: string;
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
  /** HTTP x-request-id used to correlate RunSSE request/response pairs. */
  httpRequestId?: string;
  isCursorHost?: boolean;
  durationMs?: number;
  errorKind?: string;
  errorMessage?: string;
  protocolVersion?: HttpProtocolVersion;
  /** Frequent token_delta accumulation for live status bar (persisted via minute buckets). */
  isLiveTokenUpdate?: boolean;
  /** Server turn_ended from live stream decode (billing-grade; persisted). */
  isTurnEnded?: boolean;
  liveTokenData?: {
    accumulatedTokens: number;
    latestDelta: number;
    /** Model id active for this stream (from BidiAppend runRequest). */
    modelId?: string;
    /** Incremental cost of latestDelta in USD cents. */
    deltaCostCents?: number;
  };
}

export interface MitmProxyHandlers {
  onTraffic?: (summary: ProxyTrafficSummary) => void;
  onProxyError?: (summary: ProxyTrafficSummary) => void;
}
