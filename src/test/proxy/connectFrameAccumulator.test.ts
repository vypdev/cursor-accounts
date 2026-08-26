import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { wrapConnectEnvelope } from '../../proxy/connectDecode';
import { ConnectFrameAccumulator } from '../../proxy/connectFrameAccumulator';

describe('ConnectFrameAccumulator', () => {
  it('extracts multiple complete frames in order', () => {
    const accumulator = new ConnectFrameAccumulator();
    const result = accumulator.feed(
      Buffer.concat([
        wrapConnectEnvelope(Buffer.from('first')),
        wrapConnectEnvelope(Buffer.from('second')),
      ])
    );

    assert.deepEqual(result.map((payload) => payload.toString()), [
      'first',
      'second',
    ]);
    assert.equal(accumulator.bufferedLength, 0);
  });

  it('buffers an incomplete frame until its remaining bytes arrive', () => {
    const accumulator = new ConnectFrameAccumulator();
    const frame = wrapConnectEnvelope(Buffer.from('payload'));

    assert.deepEqual(accumulator.feed(frame.subarray(0, 4)), []);
    assert.equal(accumulator.bufferedLength, 4);
    assert.deepEqual(
      accumulator.feed(frame.subarray(4)).map((payload) => payload.toString()),
      ['payload']
    );
    assert.equal(accumulator.bufferedLength, 0);
  });

  it('skips malformed bytes before a valid frame', () => {
    const accumulator = new ConnectFrameAccumulator();
    const frame = wrapConnectEnvelope(Buffer.from('valid'));

    const result = accumulator.feed(Buffer.concat([Buffer.from([0xff, 0x01]), frame]));

    assert.deepEqual(result.map((payload) => payload.toString()), ['valid']);
    assert.equal(accumulator.bufferedLength, 0);
  });

  it('ignores empty chunks without changing buffered state', () => {
    const accumulator = new ConnectFrameAccumulator();

    assert.deepEqual(accumulator.feed(Buffer.alloc(0)), []);
    assert.equal(accumulator.bufferedLength, 0);
  });

  it('clears buffered bytes on reset', () => {
    const accumulator = new ConnectFrameAccumulator();
    accumulator.feed(Buffer.from([0, 0, 0]));

    accumulator.reset();

    assert.equal(accumulator.bufferedLength, 0);
  });
});
