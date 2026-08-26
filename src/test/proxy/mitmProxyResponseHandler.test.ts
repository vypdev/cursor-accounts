import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyLogEntry } from '../../proxy/types';
import { NullLogger, type ProxyTrafficLogger } from '../../proxy/nullLogger';
import { RunSseStreamHandler } from '../../proxy/capture/runSseStreamHandler';
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
  responseEndHandlers: ResponseEndHandler[]
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
      headers: {
        'content-type': 'text/plain',
      },
      statusCode: 200,
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
  }>
): MitmProxyResponseHandlerDependencies {
  const logger = new NullLogger() as ProxyTrafficLogger;
  logger.log = (entry) => {
    loggedEntries.push(entry);
  };

  return {
    statistics,
    requestStartedAt,
    streamingDecoders: new Map(),
    requestLogger: logger,
    runSseHandler: new RunSseStreamHandler(() => {}),
    getDiagnostics: () => null,
    getProtoRegistry: async () => {
      throw new Error('The non-streaming response must not initialize protobufs');
    },
    buildRequestUrl: () => 'https://api2.cursor.sh/health',
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
});
