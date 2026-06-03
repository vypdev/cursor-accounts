import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRpcPath } from '../proxy/proxyDecode';
import {
  extractAgentInnerInsights,
  extractAgentSessionInfo,
  extractInsightsForRpc,
} from '../proxy/proxyInsightExtractor';
import {
  getProtoRegistry,
  resetProtoRegistryForTests,
} from '../proxy/protoRegistry';

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
