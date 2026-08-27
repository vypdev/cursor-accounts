import type { ProxyInsights } from '../domain/types/proxyInsights';
import type { ProxyLogEntry } from './types';

export interface DecodeProtoResult {
  decoded?: Record<string, unknown>;
  insights?: ProxyInsights;
  rpcPath?: string;
  error?: string;
}

export interface DecodeContext {
  rpcPath: string;
  direction: ProxyLogEntry['direction'];
  rawBody: Buffer;
  contentEncoding?: string;
}
