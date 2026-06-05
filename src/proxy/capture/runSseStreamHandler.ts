import type { ProxyTrafficSummary } from '../../application/types/proxyTraffic';
import type { LiveTokenUpdate, TurnEndedEvent } from '../streamingAgentDecoder';
import { formatEndpoint } from '../proxyTrafficFormat';

export interface RunSseEmitContext {
  url: string;
  host: string;
  statusCode?: number;
  bidiRequestId?: string;
  httpRequestId?: string;
  isCursorHost: boolean;
}

/**
 * Builds ProxyTrafficSummary events from incremental RunSSE decode results.
 */
export class RunSseStreamHandler {
  constructor(
    private readonly onTraffic: (summary: ProxyTrafficSummary) => void
  ) {}

  emitLiveTokenUpdate(
    update: LiveTokenUpdate,
    context: RunSseEmitContext
  ): void {
    this.onTraffic({
      timestamp: new Date().toISOString(),
      kind: 'response',
      url: context.url,
      host: context.host,
      endpoint: formatEndpoint(context.url, context.host),
      statusCode: context.statusCode,
      rpcPath: context.url.includes('/')
        ? context.url.replace(/^https?:\/\/[^/]+/, '')
        : undefined,
      isLiveTokenUpdate: true,
      liveTokenData: {
        accumulatedTokens: update.accumulatedTokens,
        latestDelta: update.latestDelta,
      },
      insights: {
        agent: {
          ...update.agent,
          requestId: context.bidiRequestId,
        },
      },
      httpRequestId: context.httpRequestId,
      isCursorHost: context.isCursorHost,
    });
  }

  emitTurnEnded(event: TurnEndedEvent, context: RunSseEmitContext): void {
    this.onTraffic({
      timestamp: new Date().toISOString(),
      kind: 'response',
      url: context.url,
      host: context.host,
      endpoint: formatEndpoint(context.url, context.host),
      statusCode: context.statusCode,
      rpcPath: context.url.includes('/')
        ? context.url.replace(/^https?:\/\/[^/]+/, '')
        : undefined,
      isTurnEnded: true,
      insights: {
        agent: {
          ...event.agent,
          requestId: context.bidiRequestId,
        },
        streamingTurnsAlreadyPersisted: true,
      },
      httpRequestId: context.httpRequestId,
      isCursorHost: context.isCursorHost,
    });
  }
}
