import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import {
  decodeAgentServerPayload,
  estimateTokensFromChars,
  extractTextBucketsFromMessage,
  mergeTextBuckets,
  scanAgentServerStream,
  scanConnectFrames,
  sumStreamDeltaText,
  sumUniquePrefetchedBlobChars,
  tryConnectFrame,
} from './lib/agent-text-extract.mjs';

function createFakeType() {
  return {
    decode(payload) {
      if (payload.length === 2 && payload[0] === 8 && payload[1] === 1) {
        return { value: 1 };
      }
      throw new Error('invalid agent payload');
    },
    toObject(message) {
      return { value: message.value };
    },
  };
}

function framedPayload(payload) {
  const frame = Buffer.alloc(5 + payload.length);
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

test('agent frame boundaries decode raw, gzip, and incomplete Connect payloads', () => {
  const Type = createFakeType();
  const payload = Buffer.from([8, 1]);
  const frame = framedPayload(payload);

  assert.deepEqual(tryConnectFrame(frame, 0), {
    payload,
    nextOffset: frame.length,
  });
  assert.equal(tryConnectFrame(frame.subarray(0, 4), 0), null);
  assert.deepEqual(decodeAgentServerPayload(Type, payload), { value: 1 });
  assert.deepEqual(decodeAgentServerPayload(Type, zlib.gzipSync(payload)), {
    value: 1,
  });
  assert.deepEqual(scanAgentServerStream(Type, frame), [{ value: 1 }]);
  assert.deepEqual(scanConnectFrames(Type, frame), [{ value: 1 }]);
  assert.deepEqual(scanConnectFrames(Type, frame.subarray(0, 5)), []);
});

test('text buckets classify input/output, decode printable hex, skip identifiers, and merge frames', () => {
  const firstMessage = {
    userMessage: 'input message',
    assistantMessage: 'assistant output',
    content: '68656c6c6f20776f726c64',
    requestId: 'ignored identifier',
    misc: 'miscellaneous text',
  };
  const first = extractTextBucketsFromMessage(firstMessage);

  assert.equal(first.inputChars, 24);
  assert.equal(first.outputChars, 16);
  assert.equal(first.miscChars, 18);
  assert.deepEqual(first.inputSnippets, ['input message', 'hello world']);
  assert.deepEqual(first.outputSnippets, ['assistant output']);

  const merged = mergeTextBuckets([firstMessage, { textDelta: 'generated text' }]);
  assert.equal(merged.frameCount, 2);
  assert.equal(merged.inputChars, 24);
  assert.equal(merged.outputChars, 30);
  assert.equal(merged.miscChars, 18);
});

test('token metrics normalize stream updates, dedupe prefetched blobs, and estimate counts', () => {
  const metrics = sumStreamDeltaText([
    {
      interactionUpdate: {
        textDelta: { text: 'abc' },
        thinkingDelta: { text: 'think' },
        tokenDelta: { tokens: '12' },
        turnEnded: { inputTokens: '10.9', outputTokens: 20 },
      },
    },
    {
      interaction_update: {
        token_delta: { tokens: 'invalid' },
        turn_ended: { input_tokens: -1, output_tokens: 30 },
      },
    },
  ]);

  assert.deepEqual(metrics, {
    textDeltaChars: 3,
    thinkingDeltaChars: 5,
    tokenDeltaEvents: 1,
    tokenDeltaPeak: 12,
    turnEndedEvents: 2,
    turnEndedInput: 10,
    turnEndedOutput: 50,
  });

  assert.equal(
    sumUniquePrefetchedBlobChars([
      { runRequest: { preFetchedBlobs: [{ value: 'abcdefgh' }] } },
      { run_request: { pre_fetched_blobs: [{ value: 'abcdefgh' }, { value: 'ijklmnop' }] } },
    ]),
    16
  );
  assert.deepEqual(estimateTokensFromChars(10), {
    charsDiv4: 3,
    charsDiv3_5: 3,
    wordsX1_3: 3,
  });
});
