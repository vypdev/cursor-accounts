import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  connectPayloadCandidates,
  stripConnectEnvelope,
} from '../proxy/connectDecode';

describe('connectDecode', () => {
  it('strips Connect envelope framing', () => {
    const payload = Buffer.from([0x08, 0x01]);
    const framed = Buffer.alloc(5 + payload.length);
    framed.writeUInt8(0, 0);
    framed.writeUInt32BE(payload.length, 1);
    payload.copy(framed, 5);

    const stripped = stripConnectEnvelope(framed);
    assert.equal(stripped.length, 1);
    assert.ok(stripped[0]);
    assert.deepEqual([...stripped[0]!], [0x08, 0x01]);
  });

  it('returns raw body when no envelope', () => {
    const raw = Buffer.from([1, 2, 3]);
    const candidates = connectPayloadCandidates(raw);
    assert.ok(candidates.some((c) => c.equals(raw)));
  });
});
