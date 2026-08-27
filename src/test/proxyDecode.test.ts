import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodeProtoEntry,
  messageTypeName,
  parseRpcPath,
} from '../proxy/proxyDecode';
import {
  decodeBinaryPayloads,
  type BinaryDecoderDependencies,
} from '../proxy/proxyBinaryDecoder';
import {
  extractAgentInnerInsights,
  extractAgentSessionInfo,
  extractInsightsForRpc,
} from '../proxy/proxyInsightExtractor';
import {
  getProtoRegistry,
  resetProtoRegistryForTests,
} from '../proxy/protoRegistry';
import type { ProxyLogEntry } from '../proxy/types';
import type { ProtoRegistry } from '../proxy/protoRegistry';

function entry(overrides: Partial<ProxyLogEntry> = {}): ProxyLogEntry {
  return {
    timestamp: '2026-08-25T00:00:00.000Z',
    direction: 'response',
    url: 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
    host: 'api2.cursor.sh',
    headers: {},
    ...overrides,
  };
}

function binaryContext(
  overrides: Partial<ProxyLogEntry> = {}
): { entry: ProxyLogEntry; context: Parameters<typeof decodeBinaryPayloads>[1] } {
  const currentEntry = entry({
    bodyBase64: Buffer.from([1]).toString('base64'),
    bodyEncoding: 'base64',
    headers: { 'content-type': 'application/connect+proto' },
    ...overrides,
  });
  return {
    entry: currentEntry,
    context: {
      rpcPath: parseRpcPath(currentEntry.url) ?? currentEntry.url,
      direction: currentEntry.direction,
      rawBody: Buffer.from([1]),
    },
  };
}

function fakeRegistry(
  overrides: Partial<ProtoRegistry> = {}
): ProtoRegistry {
  return {
    getRpcTypes: () => undefined,
    lookupMessageType: () => ({}) as never,
    decode: () => ({ decoded: true }),
    getRpcPathCount: () => 0,
    initialize: async () => undefined,
    ...overrides,
  } as ProtoRegistry;
}

function dependencies(registry: ProtoRegistry): BinaryDecoderDependencies {
  return {
    loadRegistry: async () => registry,
    enrichAgentStream: async () => undefined,
  };
}

describe('parseRpcPath', () => {
  it('parses aiserver RPC URLs', () => {
    assert.equal(
      parseRpcPath(
        'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage'
      ),
      '/aiserver.v1.DashboardService/GetCurrentPeriodUsage'
    );
  });

  it('parses agent RPC URLs on api2', () => {
    assert.equal(
      parseRpcPath('https://api2.cursor.sh/agent.v1.AgentService/RunPoll'),
      '/agent.v1.AgentService/RunPoll'
    );
  });

  it('falls back to the RPC pattern for a relative or malformed URL', () => {
    assert.equal(
      parseRpcPath('/aiserver.v1.DashboardService/GetCurrentPeriodUsage'),
      '/aiserver.v1.DashboardService/GetCurrentPeriodUsage'
    );
    assert.equal(parseRpcPath('not-an-rpc-url'), null);
  });

  it('rejects non-Cursor RPC paths', () => {
    assert.equal(parseRpcPath('https://example.com/Service/Method'), null);
  });

  it('builds request and response message names', () => {
    assert.equal(messageTypeName('BidiAppend', 'request'), 'aiserver.v1.BidiAppendRequest');
    assert.equal(messageTypeName('BidiAppend', 'response'), 'aiserver.v1.BidiAppendResponse');
  });

  it('returns precise errors before attempting to decode', async () => {
    assert.deepEqual(await decodeProtoEntry(entry()), { error: 'No body data' });
    assert.deepEqual(
      await decodeProtoEntry(
        entry({
          body: '{}',
          headers: { 'content-type': 'application/json' },
          url: 'https://example.com/not-an-rpc',
        })
      ),
      { error: 'Not a Connect RPC URL (aiserver/agent)' }
    );
  });

  it('decodes and redacts JSON RPC payloads', async () => {
    const result = await decodeProtoEntry(
      entry({
        direction: 'request',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: 'req-1', access_token: 'secret' }),
      })
    );

    assert.equal(result.rpcPath, '/aiserver.v1.DashboardService/GetCurrentPeriodUsage');
    assert.equal(result.error, undefined);
    assert.equal(result.decoded?.access_token, '[REDACTED]');
  });

  it('returns a JSON parse error without throwing', async () => {
    const result = await decodeProtoEntry(
      entry({
        headers: { 'content-type': 'application/json' },
        body: '{invalid-json',
      })
    );

    assert.equal(result.rpcPath, '/aiserver.v1.DashboardService/GetCurrentPeriodUsage');
    assert.match(result.error ?? '', /JSON|Unexpected token|position/i);
  });

  it('decodes a known binary RPC payload through the registry', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const types = registry.getRpcTypes('/aiserver.v1.BidiService/BidiAppend');
    assert.ok(types);
    const payload = types.requestType
      .encode(
        types.requestType.create({
          data: 'hello',
          requestId: { requestId: 'req-binary' },
          appendSeqno: 2,
        })
      )
      .finish();

    const result = await decodeProtoEntry(
      entry({
        direction: 'request',
        url: 'https://api2.cursor.sh/aiserver.v1.BidiService/BidiAppend',
        headers: { 'content-type': 'application/connect+proto' },
        bodyBase64: Buffer.from(payload).toString('base64'),
        bodyEncoding: 'base64',
      })
    );

    assert.equal(result.error, undefined);
    assert.equal(result.decoded?.data, 'hello');
    assert.equal(result.insights?.agent?.requestId, 'req-binary');
  });

  it('reports unknown and malformed binary payloads safely', async () => {
    const unknown = await decodeProtoEntry(
      entry({
        bodyBase64: Buffer.from([1]).toString('base64'),
        bodyEncoding: 'base64',
        url: 'https://api2.cursor.sh/aiserver.v1.UnknownService/Unknown',
        headers: { 'content-type': 'application/connect+proto' },
      })
    );
    assert.equal(unknown.error, 'Unknown RPC: /aiserver.v1.UnknownService/Unknown');

    const malformed = await decodeProtoEntry(
      entry({
        direction: 'request',
        bodyBase64: Buffer.from([0xff, 0xff]).toString('base64'),
        bodyEncoding: 'base64',
        url: 'https://api2.cursor.sh/aiserver.v1.BidiService/BidiAppend',
        headers: { 'content-type': 'application/connect+proto' },
      })
    );
    assert.equal(malformed.rpcPath, '/aiserver.v1.BidiService/BidiAppend');
    assert.ok(malformed.error || malformed.insights);
  });

  it('supports already-decompressed payloads through the injected registry', async () => {
    const { entry: currentEntry, context } = binaryContext({
      bodyDecompressed: true,
    });
    const result = await decodeBinaryPayloads(
      currentEntry,
      context,
      dependencies(fakeRegistry())
    );

    assert.equal(result.error, undefined);
    assert.equal(result.decoded?.decoded, true);
  });

  it('returns a stable error for an unknown RPC type', async () => {
    const { entry: currentEntry, context } = binaryContext({
      url: 'https://api2.cursor.sh/aiserver.v1.UnknownService/Unknown',
    });
    const registry = fakeRegistry({ lookupMessageType: () => null });
    const result = await decodeBinaryPayloads(
      currentEntry,
      context,
      dependencies(registry)
    );

    assert.deepEqual(result, {
      error: `Unknown RPC: ${context.rpcPath}`,
      rpcPath: context.rpcPath,
    });
  });

  it('preserves decoder failures', async () => {
    const { entry: currentEntry, context } = binaryContext();
    const registry = fakeRegistry({
      decode: () => {
        throw new Error('decoder failed');
      },
    });
    const result = await decodeBinaryPayloads(
      currentEntry,
      context,
      dependencies(registry)
    );

    assert.equal(result.error, 'decoder failed');
    assert.equal(result.rpcPath, context.rpcPath);
  });

  it('uses the injected agent-stream fallback when single-payload decoding fails', async () => {
    const { entry: currentEntry, context } = binaryContext({
      direction: 'response',
      url: 'https://api2.cursor.sh/agent.v1.AgentService/RunSSE',
    });
    const registry = fakeRegistry({
      decode: () => {
        throw new Error('single payload failed');
      },
    });
    const result = await decodeBinaryPayloads(currentEntry, context, {
      loadRegistry: async () => registry,
      enrichAgentStream: async () => ({ tokens: { totalTokens: 7 } }),
    });

    assert.deepEqual(result, {
      insights: { tokens: { totalTokens: 7 } },
      rpcPath: context.rpcPath,
    });
  });

  it('normalizes loader failures without throwing', async () => {
    const { entry: currentEntry, context } = binaryContext();
    const result = await decodeBinaryPayloads(currentEntry, context, {
      loadRegistry: () => Promise.reject(new Error('registry unavailable')),
      enrichAgentStream: async () => undefined,
    });

    assert.deepEqual(result, {
      error: 'registry unavailable',
      rpcPath: context.rpcPath,
    });
  });
});

describe('extractAgentSessionInfo', () => {
  it('extracts request id from BidiPollRequest shape', () => {
    const info = extractAgentSessionInfo({
      requestId: { requestId: 'req-abc-123' },
      startRequest: true,
    });
    assert.equal(info?.requestId, 'req-abc-123');
  });

  it('extracts append seqno from BidiAppendRequest shape', () => {
    const info = extractAgentSessionInfo({
      request_id: { request_id: 'req-xyz' },
      append_seqno: '42',
    });
    assert.equal(info?.requestId, 'req-xyz');
    assert.equal(info?.appendSeqno, 42);
  });

  it('extracts data preview and binary length from BidiAppend', () => {
    const info = extractAgentSessionInfo({
      requestId: { requestId: 'req-data' },
      appendSeqno: 1,
      data: '{"type":"user"}',
      dataBinary: Buffer.from([1, 2, 3]),
    });
    assert.equal(info?.requestId, 'req-data');
    assert.equal(info?.dataPreview, '{"type":"user"}');
    assert.equal(info?.dataBytes, 3);
  });

  it('extracts token_delta from inner agent server message', () => {
    const info = extractAgentInnerInsights({
      interactionUpdate: { tokenDelta: { tokens: 603 } },
    });
    assert.equal(info?.streamingTokens, 603);
    assert.equal(info?.usageEvent, 'token_delta');
  });

  it('extracts turn_ended token breakdown', () => {
    const info = extractAgentInnerInsights({
      interactionUpdate: {
        turnEnded: {
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 50,
        },
      },
    });
    assert.equal(info?.inputTokens, 1000);
    assert.equal(info?.outputTokens, 200);
    assert.equal(info?.cacheReadTokens, 50);
    assert.equal(info?.usageEvent, 'turn_ended');
  });

  it('rejects turn_ended values above MAX_SANE_TURN_TOKENS', () => {
    const info = extractAgentInnerInsights({
      interactionUpdate: {
        turnEnded: {
          inputTokens: 314_202_530_873_276,
          outputTokens: 200,
        },
      },
    });
    assert.equal(info, null);
  });

  it('includes agent insights for BidiAppend rpc path', () => {
    const insights = extractInsightsForRpc(
      '/aiserver.v1.BidiService/BidiAppend',
      {
        requestId: { requestId: 'append-1' },
        appendSeqno: 2,
        data: 'hello',
      }
    );
    assert.equal(insights?.agent?.requestId, 'append-1');
    assert.equal(insights?.agent?.appendSeqno, 2);
    assert.equal(insights?.agent?.dataPreview, 'hello');
  });

  it('registers BidiAppend in proto RPC map', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const types = registry.getRpcTypes('/aiserver.v1.BidiService/BidiAppend');
    assert.ok(types?.requestType);
    assert.equal(types?.requestType.name, 'BidiAppendRequest');
    assert.ok(types?.responseType);
  });

  it('includes agent insights for RunPoll rpc path', () => {
    const insights = extractInsightsForRpc('/agent.v1.AgentService/RunPoll', {
      requestId: { requestId: 'poll-1' },
    });
    assert.equal(insights?.agent?.requestId, 'poll-1');
  });
});
