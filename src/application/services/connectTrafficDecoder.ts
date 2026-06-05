import type { ProxyLogEntry } from '../../proxy/types';
import type {
  DecodeResult,
  IStreamDecoder,
  ITrafficDecoder,
  StreamDecoderContext,
} from '../../domain/ports/ITrafficDecoder';
import { buildTrafficSummary } from '../../proxy/trafficSummaryBuilder';

/**
 * Batch decode for JSONL tail and end-of-response summaries.
 * Incremental RunSSE decoding remains in MitmProxyServer until RunSseStreamHandler migration.
 */
export class ConnectTrafficDecoder implements ITrafficDecoder {
  async decodeBatch(entry: ProxyLogEntry): Promise<DecodeResult> {
    const summary = await buildTrafficSummary(entry);
    return {
      summary,
      insights: summary.insights ?? null,
    };
  }

  createStreamDecoder(
    _requestId: string,
    _context: StreamDecoderContext
  ): IStreamDecoder {
    return {
      feedChunk: () => undefined,
      emitLiveUpdate: () => null,
      emitTurnEnded: () => null,
      finalize: () => null,
    };
  }
}
