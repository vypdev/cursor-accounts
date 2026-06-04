import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scanConnectAgentServerStream } from '../../proxy/agentStreamDecode';
import { wrapConnectEnvelope } from '../../proxy/connectDecode';
import { getProtoRegistry, resetProtoRegistryForTests } from '../../proxy/protoRegistry';
import { StreamingAgentDecoder } from '../../proxy/streamingAgentDecoder';
import { TokenTurnDetectionService } from '../../domain/services/tokenTurnDetectionService';

async function buildTokenDeltaFrame(registry: Awaited<ReturnType<typeof getProtoRegistry>>, tokens: number): Promise<Buffer> {
  const type = registry.lookupMessageType('agent.v1.AgentServerMessage');
  assert.ok(type);
  const payload = type.encode(
    type.create({
      interactionUpdate: { tokenDelta: { tokens } },
    })
  ).finish();
  return wrapConnectEnvelope(Buffer.from(payload));
}

describe('StreamingAgentDecoder', () => {
  it('decodes complete frame in single chunk', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const frame = await buildTokenDeltaFrame(registry, 42);
    const decoder = new StreamingAgentDecoder(registry);

    const turns = decoder.feedChunk(frame);
    assert.equal(turns.length, 0);

    const finalTurn = decoder.finalize();
    assert.ok(finalTurn);
    assert.equal(finalTurn?.turn.streamingTokens, 42);
    assert.equal(finalTurn?.turn.turnIndex, 0);
  });

  it('buffers partial frame across chunks', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const frame = await buildTokenDeltaFrame(registry, 99);
    const decoder = new StreamingAgentDecoder(registry);

    const head = frame.subarray(0, 3);
    const tail = frame.subarray(3);

    assert.deepEqual(decoder.feedChunk(head), []);
    assert.ok(decoder.getState().bufferLength > 0);

    assert.deepEqual(decoder.feedChunk(tail), []);
    const finalTurn = decoder.finalize();
    assert.equal(finalTurn?.turn.streamingTokens, 99);
  });

  it('detects turn reset when peak≥300 drops≤150', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const stream = Buffer.concat([
      await buildTokenDeltaFrame(registry, 300),
      await buildTokenDeltaFrame(registry, 100),
      await buildTokenDeltaFrame(registry, 200),
    ]);
    const decoder = new StreamingAgentDecoder(registry);

    const turns = decoder.feedChunk(stream);
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.turn.streamingTokens, 300);
    assert.equal(turns[0]?.turn.turnIndex, 0);

    const finalTurn = decoder.finalize();
    assert.equal(finalTurn?.turn.streamingTokens, 200);
    assert.equal(finalTurn?.turn.turnIndex, 1);
  });

  it('emits multiple turns from single chunk', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const stream = Buffer.concat([
      await buildTokenDeltaFrame(registry, 350),
      await buildTokenDeltaFrame(registry, 120),
      await buildTokenDeltaFrame(registry, 400),
      await buildTokenDeltaFrame(registry, 90),
      await buildTokenDeltaFrame(registry, 150),
    ]);
    const decoder = new StreamingAgentDecoder(registry);

    const turns = decoder.feedChunk(stream);
    assert.equal(turns.length, 2);
    assert.equal(turns[0]?.turn.streamingTokens, 350);
    assert.equal(turns[1]?.turn.streamingTokens, 400);

    const finalTurn = decoder.finalize();
    assert.equal(finalTurn?.turn.streamingTokens, 150);
    assert.equal(finalTurn?.turn.turnIndex, 2);
  });

  it('finalizes remaining turn at stream end', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const decoder = new StreamingAgentDecoder(registry);
    decoder.feedChunk(await buildTokenDeltaFrame(registry, 80));
    const finalTurn = decoder.finalize();
    assert.equal(finalTurn?.turn.streamingTokens, 80);
  });

  it('handles empty chunks gracefully', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const decoder = new StreamingAgentDecoder(registry);
    assert.deepEqual(decoder.feedChunk(Buffer.alloc(0)), []);
    decoder.feedChunk(await buildTokenDeltaFrame(registry, 10));
    assert.equal(decoder.finalize()?.turn.streamingTokens, 10);
  });

  it('matches batch scanConnectAgentServerStream turn totals', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const tokens = [42, 300, 120, 250, 400, 100, 180];
    const stream = Buffer.concat(
      await Promise.all(tokens.map((value) => buildTokenDeltaFrame(registry, value)))
    );

    const batch = scanConnectAgentServerStream(registry, stream);
    const batchTurns = new TokenTurnDetectionService().detectTurns(
      batch.allTokenFrames
    );

    const decoder = new StreamingAgentDecoder(registry);
    const fromChunk = decoder.feedChunk(stream);
    const finalTurn = decoder.finalize();
    const incrementalTurns = [...fromChunk, ...(finalTurn ? [finalTurn] : [])].map(
      (item) => item.turn
    );

    assert.deepEqual(
      incrementalTurns.map((turn) => turn.streamingTokens),
      batchTurns.map((turn) => turn.streamingTokens)
    );
  });

  it('merges agent insights per turn', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const decoder = new StreamingAgentDecoder(registry);
    decoder.feedChunk(await buildTokenDeltaFrame(registry, 320));
    const finalTurn = decoder.finalize();
    assert.ok(finalTurn);
    assert.equal(finalTurn.agent.usageEvent, 'token_delta');
    assert.equal(finalTurn.agent.streamingTokens, 320);
  });
});
