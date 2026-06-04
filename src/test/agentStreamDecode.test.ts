import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isAgentServerStreamRpc,
  mergeAgentStreamFrameInsights,
  scanConnectAgentServerStream,
} from '../proxy/agentStreamDecode';
import { wrapConnectEnvelope } from '../proxy/connectDecode';
import { getProtoRegistry, resetProtoRegistryForTests } from '../proxy/protoRegistry';

describe('agentStreamDecode', () => {
  it('detects RunSSE server stream RPCs', () => {
    assert.equal(
      isAgentServerStreamRpc('/agent.v1.AgentService/RunSSE', 'response'),
      true
    );
    assert.equal(
      isAgentServerStreamRpc('/agent.v1.AgentService/RunSSE', 'request'),
      false
    );
    assert.equal(
      isAgentServerStreamRpc('/agent.v1.AgentService/RunPoll', 'response'),
      false
    );
  });

  it('merges stream frames preferring turn_ended over token_delta', () => {
    const merged = mergeAgentStreamFrameInsights([
      { streamingTokens: 10, usageEvent: 'token_delta' },
      { streamingTokens: 20, usageEvent: 'token_delta' },
      {
        inputTokens: 100,
        outputTokens: 50,
        usageEvent: 'turn_ended',
      },
    ]);

    assert.equal(merged?.usageEvent, 'turn_ended');
    assert.equal(merged?.inputTokens, 100);
    assert.equal(merged?.outputTokens, 50);
  });

  it('scans multiple Connect frames and keeps the latest token_delta', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const type = registry.lookupMessageType('agent.v1.AgentServerMessage');
    assert.ok(type);

    const heartbeat = type.encode(
      type.create({ interactionUpdate: { heartbeat: {} } })
    ).finish();
    const delta1 = type.encode(
      type.create({
        interactionUpdate: { tokenDelta: { tokens: 42 } },
      })
    ).finish();
    const delta2 = type.encode(
      type.create({
        interactionUpdate: { tokenDelta: { tokens: 603 } },
      })
    ).finish();

    const stream = Buffer.concat([
      wrapConnectEnvelope(Buffer.from(heartbeat)),
      wrapConnectEnvelope(Buffer.from(delta1)),
      wrapConnectEnvelope(Buffer.from(delta2)),
    ]);

    const scan = scanConnectAgentServerStream(registry, stream);
    assert.equal(scan.messageCount, 3);
    assert.equal(scan.tokenDeltaCount, 2);
    assert.equal(scan.mergedAgent?.streamingTokens, 603);
    assert.equal(scan.mergedAgent?.usageEvent, 'token_delta');
    assert.equal(scan.allTokenFrames.length, 2);
    assert.equal(scan.allTokenFrames[0]?.streamingTokens, 42);
    assert.equal(scan.allTokenFrames[1]?.streamingTokens, 603);
  });
});
