import type { ProxyLogEntry } from '../types/proxyLog';
import type { ProxyInsights } from '../types/proxyInsights';
import type { ProxyTrafficSummary } from '../types/proxyTraffic';

export interface DecodeResult {
  summary: ProxyTrafficSummary;
  insights: ProxyInsights | null;
}

export interface IStreamDecoder {
  feedChunk(chunk: Buffer): void;
  emitLiveUpdate(): ProxyTrafficSummary | null;
  emitTurnEnded(): ProxyTrafficSummary | null;
  finalize(): ProxyInsights | null;
}

export interface ITrafficDecoder {
  decodeBatch(entry: ProxyLogEntry): Promise<DecodeResult>;
  createStreamDecoder(requestId: string, context: StreamDecoderContext): IStreamDecoder;
}

export interface StreamDecoderContext {
  url: string;
  host: string;
  method?: string;
  httpRequestId?: string;
}
