import type { ProxyLogEntry } from '../../application/types/proxyLog';
import type { ProxyInsights } from '../../application/types/proxyInsights';
import type { ProxyTrafficSummary } from '../../application/types/proxyTraffic';

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
