import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  connectPayloadCandidates,
  decompressBody,
  prepareConnectPayload,
  stripConnectEnvelope,
  wrapConnectEnvelope,
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

  it('collects envelope and legacy length-prefixed payload candidates once', () => {
    const payload = Buffer.from([0x08, 0x01]);
    const envelope = wrapConnectEnvelope(payload);
    const legacy32 = Buffer.alloc(5 + payload.length);
    legacy32.writeUInt8(0, 0);
    legacy32.writeUInt32BE(payload.length, 1);
    payload.copy(legacy32, 5);
    const legacy16 = Buffer.alloc(3 + payload.length);
    legacy16.writeUInt8(0, 0);
    legacy16.writeUInt16BE(payload.length, 1);
    payload.copy(legacy16, 3);

    const candidates = connectPayloadCandidates(
      Buffer.concat([envelope, legacy16])
    );

    assert.equal(candidates.filter((candidate) => candidate.equals(payload)).length, 1);
    assert.ok(candidates.some((candidate) => candidate.equals(legacy16)));
    assert.ok(
      connectPayloadCandidates(legacy32).some((candidate) =>
        candidate.equals(payload)
      )
    );
  });

  it('retains malformed and truncated input without reading beyond the body', () => {
    const truncatedHeader = Buffer.from([0, 0, 0, 0]);
    const truncatedPayload = Buffer.from([0, 0, 0, 0, 4, 1]);

    assert.deepEqual(
      stripConnectEnvelope(truncatedHeader).map((payload) => [...payload]),
      [[0, 0, 0, 0]]
    );
    const candidates = connectPayloadCandidates(truncatedPayload);
    assert.ok(
      candidates.some((payload) => payload.equals(truncatedPayload))
    );
  });

  it('decompresses supported encodings before collecting candidates', () => {
    const payload = Buffer.from('payload');
    const gzip = gzipSync(wrapConnectEnvelope(payload));

    assert.deepEqual([...decompressBody(gzip, 'gzip')], [
      ...wrapConnectEnvelope(payload),
    ]);
    const candidates = prepareConnectPayload(gzip, 'gzip').map((candidate) =>
      candidate.toString()
    );
    assert.ok(candidates.includes(wrapConnectEnvelope(payload).toString()));
    assert.ok(candidates.includes(payload.toString()));
  });
});
