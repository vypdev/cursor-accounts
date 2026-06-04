import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { wrapConnectEnvelope } from '../../proxy/connectDecode';
import { getProtoRegistry, resetProtoRegistryForTests } from '../../proxy/protoRegistry';
import { StreamingAgentDecoder } from '../../proxy/streamingAgentDecoder';

async function buildTokenDeltaFrame(
  registry: Awaited<ReturnType<typeof getProtoRegistry>>,
  tokens: number
): Promise<Buffer> {
  const type = registry.lookupMessageType('agent.v1.AgentServerMessage');
  assert.ok(type);
  const payload = type
    .encode(
      type.create({
        interactionUpdate: { tokenDelta: { tokens } },
      })
    )
    .finish();
  return wrapConnectEnvelope(Buffer.from(payload));
}

async function buildTurnEndedFrame(
  registry: Awaited<ReturnType<typeof getProtoRegistry>>,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  }
): Promise<Buffer> {
  const type = registry.lookupMessageType('agent.v1.AgentServerMessage');
  assert.ok(type);
  const payload = type
    .encode(
      type.create({
        interactionUpdate: {
          turnEnded: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens ?? 0,
            cacheWriteTokens: usage.cacheWriteTokens ?? 0,
          },
        },
      })
    )
    .finish();
  return wrapConnectEnvelope(Buffer.from(payload));
}

describe('StreamingAgentDecoder', () => {
  it('emits live update for every token_delta', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const stream = Buffer.concat([
      await buildTokenDeltaFrame(registry, 12),
      await buildTokenDeltaFrame(registry, 24),
      await buildTokenDeltaFrame(registry, 8),
    ]);
    const decoder = new StreamingAgentDecoder(registry);

    const result = decoder.feedChunk(stream);
    assert.equal(result.turnEndedEvents.length, 0);
    assert.equal(result.liveUpdates.length, 3);
    assert.equal(result.liveUpdates[0]?.accumulatedTokens, 12);
    assert.equal(result.liveUpdates[1]?.accumulatedTokens, 36);
    assert.equal(result.liveUpdates[2]?.accumulatedTokens, 44);
    assert.equal(result.liveUpdates[2]?.latestDelta, 8);
  });

  it('emits turn_ended from server and resets accumulator', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const stream = Buffer.concat([
      await buildTokenDeltaFrame(registry, 30),
      await buildTokenDeltaFrame(registry, 20),
      await buildTurnEndedFrame(registry, {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 10,
      }),
      await buildTokenDeltaFrame(registry, 15),
    ]);
    const decoder = new StreamingAgentDecoder(registry);

    const result = decoder.feedChunk(stream);
    assert.equal(result.liveUpdates.length, 3);
    assert.equal(result.liveUpdates[1]?.accumulatedTokens, 50);
    assert.equal(result.turnEndedEvents.length, 1);
    assert.equal(result.turnEndedEvents[0]?.inputTokens, 100);
    assert.equal(result.turnEndedEvents[0]?.outputTokens, 50);
    assert.equal(result.turnEndedEvents[0]?.cacheReadTokens, 10);
    assert.equal(result.turnEndedEvents[0]?.agent.usageEvent, 'turn_ended');

    assert.equal(decoder.getState().accumulatedTokens, 15);
  });

  it('decodes complete frame in single chunk', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const frame = await buildTokenDeltaFrame(registry, 42);
    const decoder = new StreamingAgentDecoder(registry);

    const result = decoder.feedChunk(frame);
    assert.equal(result.liveUpdates.length, 1);
    assert.equal(result.liveUpdates[0]?.accumulatedTokens, 42);

    const finalLive = decoder.finalize();
    assert.equal(finalLive, null);
  });

  it('buffers partial frame across chunks', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const frame = await buildTokenDeltaFrame(registry, 99);
    const decoder = new StreamingAgentDecoder(registry);

    const head = frame.subarray(0, 3);
    const tail = frame.subarray(3);

    assert.deepEqual(decoder.feedChunk(head), {
      liveUpdates: [],
      turnEndedEvents: [],
    });
    assert.ok(decoder.getState().bufferLength > 0);

    const tailResult = decoder.feedChunk(tail);
    assert.equal(tailResult.liveUpdates[0]?.accumulatedTokens, 99);
    assert.equal(decoder.finalize(), null);
  });

  it('finalize clears state without duplicate live emit', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const decoder = new StreamingAgentDecoder(registry);
    const result = decoder.feedChunk(
      Buffer.concat([
        await buildTokenDeltaFrame(registry, 10),
        await buildTokenDeltaFrame(registry, 20),
      ])
    );
    assert.equal(result.liveUpdates[1]?.accumulatedTokens, 30);
    assert.equal(decoder.finalize(), null);
    assert.equal(decoder.getState().accumulatedTokens, 0);
  });

  it('handles empty chunks gracefully', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const decoder = new StreamingAgentDecoder(registry);
    assert.deepEqual(decoder.feedChunk(Buffer.alloc(0)), {
      liveUpdates: [],
      turnEndedEvents: [],
    });
    decoder.feedChunk(await buildTokenDeltaFrame(registry, 10));
    assert.equal(decoder.finalize(), null);
  });

  it('merges agent insights on live updates', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const decoder = new StreamingAgentDecoder(registry);
    const result = decoder.feedChunk(await buildTokenDeltaFrame(registry, 32));
    assert.equal(result.liveUpdates[0]?.agent.usageEvent, 'token_delta');
    assert.equal(result.liveUpdates[0]?.agent.streamingTokens, 32);
  });

  it('resets decoder state after finalize', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const decoder = new StreamingAgentDecoder(registry);
    decoder.feedChunk(await buildTokenDeltaFrame(registry, 50));
    decoder.finalize();

    const state = decoder.getState();
    assert.equal(state.bufferLength, 0);
    assert.equal(state.messageCount, 0);
    assert.equal(state.accumulatedTokens, 0);
  });
});
