import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { wrapConnectEnvelope } from '../../proxy/connectDecode';
import { getProtoRegistry, resetProtoRegistryForTests } from '../../proxy/protoRegistry';
import { StreamingAgentDecoder } from '../../proxy/streamingAgentDecoder';
import type { ProxyTrafficSummary } from '../../proxy/types';

describe('MitmProxyServer streaming decode', () => {
  it('emits live token updates during chunked RunSSE processing', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const type = registry.lookupMessageType('agent.v1.AgentServerMessage');
    assert.ok(type);

    const buildFrame = (tokens: number): Buffer => {
      const payload = type
        .encode(
          type.create({
            interactionUpdate: { tokenDelta: { tokens } },
          })
        )
        .finish();
      return wrapConnectEnvelope(Buffer.from(payload));
    };

    const stream = Buffer.concat([
      buildFrame(10),
      buildFrame(20),
      buildFrame(30),
    ]);

    const chunkSize = 17;
    const decoder = new StreamingAgentDecoder(registry);
    const emitted: ProxyTrafficSummary[] = [];

    for (let offset = 0; offset < stream.length; offset += chunkSize) {
      const chunk = stream.subarray(offset, offset + chunkSize);
      const result = decoder.feedChunk(chunk);
      for (const live of result.liveUpdates) {
        emitted.push({
          timestamp: new Date().toISOString(),
          kind: 'response',
          url: 'https://api2.cursor.sh/agent.v1.AgentService/RunSSE',
          host: 'api2.cursor.sh',
          endpoint: '/agent.v1.AgentService/RunSSE',
          httpRequestId: 'http-req-1',
          isLiveTokenUpdate: true,
          liveTokenData: {
            accumulatedTokens: live.accumulatedTokens,
            latestDelta: live.latestDelta,
          },
          insights: {
            agent: {
              requestId: 'bidi-req-1',
              streamingTokens: live.accumulatedTokens,
              usageEvent: 'token_delta',
            },
          },
        });
      }
    }

    assert.equal(decoder.finalize(), null);

    assert.equal(emitted.length, 3);
    assert.equal(emitted[0]?.liveTokenData?.accumulatedTokens, 10);
    assert.equal(emitted[1]?.liveTokenData?.accumulatedTokens, 30);
    assert.equal(emitted[2]?.liveTokenData?.accumulatedTokens, 60);
    assert.ok(emitted.every((e) => e.isLiveTokenUpdate));
  });

  it('cleans up decoder state after finalize', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const type = registry.lookupMessageType('agent.v1.AgentServerMessage');
    assert.ok(type);
    const payload = type
      .encode(
        type.create({
          interactionUpdate: { tokenDelta: { tokens: 50 } },
        })
      )
      .finish();
    const frame = wrapConnectEnvelope(Buffer.from(payload));

    const decoder = new StreamingAgentDecoder(registry);
    decoder.feedChunk(frame);
    decoder.finalize();

    const state = decoder.getState();
    assert.equal(state.bufferLength, 0);
    assert.equal(state.messageCount, 0);
    assert.equal(state.accumulatedTokens, 0);
  });
});
