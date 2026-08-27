import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyLogEntry, ProxyTrafficSummary } from '../../proxy/types';
import { NullLogger, type ProxyTrafficLogger } from '../../proxy/nullLogger';
import { RunSseStreamHandler } from '../../proxy/capture/runSseStreamHandler';
import { wrapConnectEnvelope } from '../../proxy/connectDecode';
import { getProtoRegistry, resetProtoRegistryForTests } from '../../proxy/protoRegistry';
import type { ProtoRegistry } from '../../proxy/protoRegistry';
import type { StreamingAgentDecoder } from '../../proxy/streamingAgentDecoder';
import {
  createMitmProxyResponseHandler,
  type MitmProxyResponseHandlerDependencies,
} from '../../proxy/mitmProxyResponseHandler';
import type { ProxyStatistics } from '@cursor-accounts/types';

type ResponseHandler = ReturnType<typeof createMitmProxyResponseHandler>;
type ResponseContext = Parameters<ResponseHandler>[0];
type ResponseDataHandler = Parameters<ResponseContext['onResponseData']>[0];
type ResponseEndHandler = Parameters<ResponseContext['onResponseEnd']>[0];

function createResponseContext(
  responseDataHandlers: ResponseDataHandler[],
  responseEndHandlers: ResponseEndHandler[],
  options: {
    headers?: Record<string, string>;
    statusCode?: number;
  } = {}
): ResponseContext {
  return {
    isSSL: false,
    uuid: 'ctx-1',
    clientToProxyRequest: {
      headers: {
        host: 'api2.cursor.sh',
        'x-request-id': 'http-request-1',
      },
      method: 'GET',
      url: '/health',
    },
    serverToProxyResponse: {
      headers: options.headers ?? { 'content-type': 'text/plain' },
      statusCode: options.statusCode ?? 200,
    },
    onResponseData(handler: ResponseDataHandler) {
      responseDataHandlers.push(handler);
    },
    onResponseEnd(handler: ResponseEndHandler) {
      responseEndHandlers.push(handler);
    },
  } as unknown as ResponseContext;
}

function createDependencies(
  statistics: ProxyStatistics,
  requestStartedAt: Map<string, number>,
  loggedEntries: ProxyLogEntry[],
  diagnostics: Array<Record<string, unknown>>,
  summaries: Array<{
    entry: ProxyLogEntry;
    durationMs?: number;
    correlation?: {
      bidiRequestId?: string;
      httpRequestId?: string;
      incrementalTurnsAlreadyPersisted?: boolean;
    };
  }>,
  options: {
    buildRequestUrl?: string;
    getProtoRegistry?: () => Promise<ProtoRegistry>;
    liveSummaries?: ProxyTrafficSummary[];
    streamingDecoders?: Map<string, StreamingAgentDecoder>;
  } = {}
): MitmProxyResponseHandlerDependencies {
  const logger = new NullLogger() as ProxyTrafficLogger;
  logger.log = (entry) => {
    loggedEntries.push(entry);
  };

  return {
    statistics,
    requestStartedAt,
    streamingDecoders: options.streamingDecoders ?? new Map(),
    requestLogger: logger,
    runSseHandler: new RunSseStreamHandler((summary) => {
      options.liveSummaries?.push(summary);
    }),
    getDiagnostics: () => null,
    getProtoRegistry:
      options.getProtoRegistry ??
      (async () => {
        throw new Error('The non-streaming response must not initialize protobufs');
      }),
    buildRequestUrl: () =>
      options.buildRequestUrl ?? 'https://api2.cursor.sh/health',
    protocolVersionFor: () => 'HTTP/1.1',
    recordDiagnostics: (input) => {
      diagnostics.push(input as unknown as Record<string, unknown>);
    },
    emitTrafficSummary: (entry, durationMs, correlation) => {
      summaries.push({ entry, durationMs, correlation });
    },
  };
}

describe('MitmProxyResponseHandler', () => {
  it('captures, logs, correlates, and closes a response callback', async () => {
    const statistics: ProxyStatistics = {
      totalRequests: 1,
      cursorRequests: 1,
      bytesTransferred: 0,
      activeConnections: 1,
    };
    const requestStartedAt = new Map([
      ['http-request-1', Date.now() - 25],
    ]);
    const loggedEntries: ProxyLogEntry[] = [];
    const diagnostics: Array<Record<string, unknown>> = [];
    const summaries: Array<{
      entry: ProxyLogEntry;
      durationMs?: number;
      correlation?: {
        bidiRequestId?: string;
        httpRequestId?: string;
        incrementalTurnsAlreadyPersisted?: boolean;
      };
    }> = [];
    const responseDataHandlers: ResponseDataHandler[] = [];
    const responseEndHandlers: ResponseEndHandler[] = [];
    const context = createResponseContext(
      responseDataHandlers,
      responseEndHandlers
    );
    const handler = createMitmProxyResponseHandler(
      createDependencies(
        statistics,
        requestStartedAt,
        loggedEntries,
        diagnostics,
        summaries
      )
    );
    let outerCallbackCalled = false;

    handler(context, () => {
      outerCallbackCalled = true;
    });
    assert.equal(outerCallbackCalled, true);
    assert.equal(responseDataHandlers.length, 1);
    assert.equal(responseEndHandlers.length, 1);

    const body = Buffer.from('ok');
    let forwardedBody: Buffer | undefined;
    responseDataHandlers[0]!(context, body, (error, forwarded) => {
      assert.equal(error, null);
      forwardedBody = forwarded;
    });
    assert.deepEqual(forwardedBody, body);

    let endCallbackCalled = false;
    await new Promise<void>((resolve) => {
      responseEndHandlers[0]!(context, () => {
        endCallbackCalled = true;
        resolve();
      });
    });

    assert.equal(endCallbackCalled, true);
    assert.equal(statistics.activeConnections, 0);
    assert.equal(statistics.bytesTransferred, body.length);
    assert.equal(requestStartedAt.has('http-request-1'), false);
    assert.equal(loggedEntries[0]?.direction, 'response');
    assert.equal(loggedEntries[0]?.requestId, 'http-request-1');
    assert.equal(diagnostics[0]?.direction, 'response');
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.correlation?.bidiRequestId, 'http-request-1');
    assert.equal(summaries[0]?.correlation?.httpRequestId, 'http-request-1');
    assert.ok((summaries[0]?.durationMs ?? 0) >= 0);
  });

  it('waits for queued RunSSE chunks before cleaning up the decoder', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const type = registry.lookupMessageType('agent.v1.AgentServerMessage');
    assert.ok(type);
    const payload = type
      .encode(
        type.create({
          interactionUpdate: { tokenDelta: { tokens: 7 } },
        })
      )
      .finish();
    const frame = wrapConnectEnvelope(Buffer.from(payload));

    let releaseRegistry!: (value: ProtoRegistry) => void;
    const delayedRegistry = new Promise<ProtoRegistry>((resolve) => {
      releaseRegistry = resolve;
    });
    const statistics: ProxyStatistics = {
      totalRequests: 1,
      cursorRequests: 1,
      bytesTransferred: 0,
      activeConnections: 1,
    };
    const loggedEntries: ProxyLogEntry[] = [];
    const diagnostics: Array<Record<string, unknown>> = [];
    const summaries: Array<{
      entry: ProxyLogEntry;
      durationMs?: number;
      correlation?: {
        bidiRequestId?: string;
        httpRequestId?: string;
        incrementalTurnsAlreadyPersisted?: boolean;
      };
    }> = [];
    const liveSummaries: ProxyTrafficSummary[] = [];
    const streamingDecoders = new Map<string, StreamingAgentDecoder>();
    const dependencies = createDependencies(
      statistics,
      new Map([['http-request-1', Date.now()]]),
      loggedEntries,
      diagnostics,
      summaries,
      {
        buildRequestUrl:
          'https://api2.cursor.sh/agent.v1.AgentService/RunSSE',
        getProtoRegistry: async () => delayedRegistry,
        liveSummaries,
        streamingDecoders,
      }
    );
    const responseDataHandlers: ResponseDataHandler[] = [];
    const responseEndHandlers: ResponseEndHandler[] = [];
    const context = createResponseContext(
      responseDataHandlers,
      responseEndHandlers,
      { headers: { 'content-type': 'application/connect+proto' } }
    );
    const handler = createMitmProxyResponseHandler(dependencies);

    handler(context, () => {});
    responseDataHandlers[0]!(context, frame, () => {});

    let ended = false;
    const endPromise = new Promise<void>((resolve) => {
      responseEndHandlers[0]!(context, () => {
        ended = true;
        resolve();
      });
    });
    await Promise.resolve();
    assert.equal(ended, false);
    assert.equal(liveSummaries.length, 0);

    releaseRegistry(registry);
    await endPromise;

    assert.equal(ended, true);
    assert.equal(liveSummaries.length, 1);
    assert.equal(liveSummaries[0]?.isLiveTokenUpdate, true);
    assert.equal(liveSummaries[0]?.liveTokenData?.accumulatedTokens, 7);
    assert.equal(streamingDecoders.has('http-request-1'), false);
    assert.equal(statistics.activeConnections, 0);
    assert.equal(loggedEntries.length, 1);
  });
});
