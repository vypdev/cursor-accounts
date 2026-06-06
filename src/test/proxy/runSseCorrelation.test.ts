import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { wrapConnectEnvelope } from '../../proxy/connectDecode';
import { getProtoRegistry, resetProtoRegistryForTests } from '../../proxy/protoRegistry';
import {
  bidiRequestIdFromRunSseHeaders,
  extractBidiRequestIdFromBody,
} from '../../proxy/runSseCorrelation';

describe('bidiRequestIdFromRunSseHeaders', () => {
  it('returns x-request-id when present', () => {
    assert.equal(
      bidiRequestIdFromRunSseHeaders({
        'x-request-id': 'b2a2d82d-569d-4372-9fd9-32fdc2ff7a97',
      }),
      'b2a2d82d-569d-4372-9fd9-32fdc2ff7a97'
    );
  });

  it('ignores traceparent-only headers', () => {
    assert.equal(
      bidiRequestIdFromRunSseHeaders({
        traceparent: '00-d31aa142ee2246252dec5f478c7f9ec6-31b7ed3973d57fd7-00',
      }),
      undefined
    );
  });
});

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
