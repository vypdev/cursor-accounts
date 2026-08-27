import {
  extractInsightsForRpc,
  redactSensitive,
} from './proxyInsightExtractor';
import {
  finalizeInsights,
} from './proxyInsightEnricher';
import type {
  DecodeContext,
  DecodeProtoResult,
} from './proxyDecodeTypes';

export async function buildDecodedResult(
  context: DecodeContext,
  decoded: Record<string, unknown>
): Promise<DecodeProtoResult> {
  const redacted = redactSensitive(decoded) as Record<string, unknown>;
  const insights = await finalizeInsights(
    context.rpcPath,
    context.direction,
    context.rawBody,
    context.contentEncoding,
    redacted,
    extractInsightsForRpc(context.rpcPath, redacted)
  );

  return {
    decoded: redacted,
    insights,
    rpcPath: context.rpcPath,
  };
}
