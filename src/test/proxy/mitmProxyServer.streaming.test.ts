import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { wrapConnectEnvelope } from '../../proxy/connectDecode';
import { getProtoRegistry, resetProtoRegistryForTests } from '../../proxy/protoRegistry';
import { StreamingAgentDecoder } from '../../proxy/streamingAgentDecoder';
import type { ProxyTrafficSummary } from '../../proxy/types';

describe('MitmProxyServer streaming decode', () => {
  it('emits partial turns during chunked RunSSE processing', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const type = registry.lookupMessageType('agent.v1.AgentServerMessage');
    assert.ok(type);

    const buildFrame = (tokens: number): Buffer => {
      const payload = type.encode(
        type.create({
          interactionUpdate: { tokenDelta: { tokens } },
        })
      ).finish();
      return wrapConnectEnvelope(Buffer.from(payload));
    };

    const stream = Buffer.concat([
      buildFrame(300),
      buildFrame(120),
      buildFrame(250),
    ]);

    const chunkSize = 17;
    const decoder = new StreamingAgentDecoder(registry);
    const emitted: ProxyTrafficSummary[] = [];

    for (let offset = 0; offset < stream.length; offset += chunkSize) {
      const chunk = stream.subarray(offset, offset + chunkSize);
      for (const turn of decoder.feedChunk(chunk)) {
        emitted.push({
          timestamp: new Date().toISOString(),
          kind: 'response',
          url: 'https://api2.cursor.sh/agent.v1.AgentService/RunSSE',
          host: 'api2.cursor.sh',
          endpoint: '/agent.v1.AgentService/RunSSE',
          httpRequestId: 'http-req-1',
          insights: {
            agent: {
              requestId: 'bidi-req-1',
              streamingTokens: turn.turn.streamingTokens,
              usageEvent: 'token_delta',
            },
            completedTurn: turn.turn,
            allTokenFrames: turn.allFrames,
          },
        });
      }
    }

    const finalTurn = decoder.finalize();
    if (finalTurn) {
      emitted.push({
        timestamp: new Date().toISOString(),
        kind: 'response',
        url: 'https://api2.cursor.sh/agent.v1.AgentService/RunSSE',
        host: 'api2.cursor.sh',
        endpoint: '/agent.v1.AgentService/RunSSE',
        httpRequestId: 'http-req-1',
        insights: {
          agent: {
            requestId: 'bidi-req-1',
            streamingTokens: finalTurn.turn.streamingTokens,
            usageEvent: 'token_delta',
          },
          completedTurn: finalTurn.turn,
          allTokenFrames: finalTurn.allFrames,
        },
      });
    }

    assert.equal(emitted.length, 2);
    assert.equal(emitted[0]?.insights?.completedTurn?.streamingTokens, 300);
    assert.equal(emitted[0]?.insights?.completedTurn?.turnIndex, 0);
    assert.equal(emitted[1]?.insights?.completedTurn?.streamingTokens, 250);
    assert.equal(emitted[1]?.insights?.completedTurn?.turnIndex, 1);
  });

  it('cleans up decoder state after finalize', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const type = registry.lookupMessageType('agent.v1.AgentServerMessage');
    assert.ok(type);
    const payload = type.encode(
      type.create({
        interactionUpdate: { tokenDelta: { tokens: 50 } },
      })
    ).finish();
    const frame = wrapConnectEnvelope(Buffer.from(payload));

    const decoder = new StreamingAgentDecoder(registry);
    decoder.feedChunk(frame);
    decoder.finalize();

    const state = decoder.getState();
    assert.equal(state.bufferLength, 0);
    assert.equal(state.messageCount, 0);
    assert.equal(state.currentPeak, 0);
  });
});
