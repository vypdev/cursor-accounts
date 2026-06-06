import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { wrapConnectEnvelope } from '../../proxy/connectDecode';
import { getProtoRegistry, resetProtoRegistryForTests } from '../../proxy/protoRegistry';
import { extractBidiRequestIdFromBody } from '../../proxy/runSseCorrelation';

describe('extractBidiRequestIdFromBody', () => {
  it('extracts request_id from a Connect-framed BidiRequestId body', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const type = registry.lookupMessageType('aiserver.v1.BidiRequestId');
    assert.ok(type);

    const payload = type
      .encode(type.create({ requestId: 'bidi-session-abc' }))
      .finish();
    const body = wrapConnectEnvelope(Buffer.from(payload));

    const bidiId = await extractBidiRequestIdFromBody(
      body,
      'application/connect+proto'
    );
    assert.equal(bidiId, 'bidi-session-abc');
  });

  it('extracts request_id from gzip-compressed Connect body', async () => {
    resetProtoRegistryForTests();
    const registry = await getProtoRegistry();
    const type = registry.lookupMessageType('aiserver.v1.BidiRequestId');
    assert.ok(type);

    const payload = type
      .encode(type.create({ requestId: 'bidi-session-gzip' }))
      .finish();
    const framed = wrapConnectEnvelope(Buffer.from(payload));
    const compressed = gzipSync(framed);

    const bidiId = await extractBidiRequestIdFromBody(
      compressed,
      'application/connect+proto',
      'gzip'
    );
    assert.equal(bidiId, 'bidi-session-gzip');
  });
});
