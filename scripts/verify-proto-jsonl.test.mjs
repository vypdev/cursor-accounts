import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import {
  connectPayloadCandidates,
  jsonKeysMatchProto,
  prepareBody,
  tryDecodeProto,
  verifyLogs,
} from './lib/proto-jsonl-verifier.mjs';

const RPC_PATH = '/aiserver.v1.TestService/TestMethod';

function createFakeType() {
  return {
    fieldsArray: [
      { name: 'known' },
      { name: 'billing_cycle_start' },
      { name: 'plan_usage' },
      { name: 'input_tokens' },
      { name: 'output_tokens' },
      { name: 'conversation_messages' },
      { name: 'request_id' },
      { name: 'eof' },
      { name: 'data' },
    ],
    decode(payload) {
      if (payload.length === 2 && payload[0] === 8 && payload[1] === 1) {
        return { known: true };
      }
      throw new Error('invalid test payload');
    },
    toObject() {
      return { known: true };
    },
  };
}

function framedPayload(payload) {
  const frame = Buffer.alloc(5 + payload.length);
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

test('connectPayloadCandidates recognizes raw and Connect length-prefixed payloads', () => {
  const payload = Buffer.from([8, 1]);
  const candidates = connectPayloadCandidates(framedPayload(payload));

  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates[1], payload);
  assert.deepEqual(candidates[2], Buffer.alloc(0));
});

test('prepareBody inflates gzip and safely retains invalid gzip', () => {
  const body = Buffer.from('payload');
  assert.deepEqual(prepareBody(zlib.gzipSync(body), 'gzip'), body);
  const invalid = Buffer.from('not gzip');
  assert.deepEqual(prepareBody(invalid, 'gzip'), invalid);
  assert.deepEqual(prepareBody(body, ''), body);
});

test('tryDecodeProto retries Connect framing and reports decode failures', () => {
  const Type = createFakeType();
  const payload = Buffer.from([8, 1]);

  assert.deepEqual(tryDecodeProto(Type, framedPayload(payload)), {
    ok: true,
    object: { known: true },
    payloadLen: payload.length,
  });
  assert.deepEqual(tryDecodeProto(Type, Buffer.from([1, 2, 3])), {
    ok: false,
    error: 'invalid test payload',
  });
});

test('jsonKeysMatchProto separates unknown keys and missing fields', () => {
  const result = jsonKeysMatchProto(
    { known: 1, unexpected: true, nullable: null },
    createFakeType()
  );

  assert.deepEqual(result.unknown, ['unexpected']);
  assert.deepEqual(result.missing, [
    'billing_cycle_start',
    'plan_usage',
    'input_tokens',
    'output_tokens',
    'conversation_messages',
    'request_id',
    'eof',
    'data',
  ]);
  assert.equal(result.protoFieldCount, 9);
});

test('verifyLogs validates JSON, protobuf, gzip, empty, unknown, and invalid captures', () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-accounts-proto-'));
  const Type = createFakeType();
  const rpcMap = new Map([[RPC_PATH, { requestType: Type, responseType: Type }]]);
  const jsonBody = JSON.stringify({
    known: true,
    billing_cycle_start: 'cycle',
    plan_usage: 10,
    input_tokens: 2,
    output_tokens: 3,
    conversation_messages: [{}],
    request_id: 'request',
  });
  const payload = Buffer.from([8, 1]);
  const gzipBody = zlib.gzipSync(framedPayload(payload)).toString('base64');
  const entries = [
    {
      direction: 'request',
      url: `https://api.test${RPC_PATH}`,
      headers: { 'content-type': 'application/json' },
      body: jsonBody,
    },
    {
      direction: 'response',
      url: `https://api.test${RPC_PATH}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ known: true, unexpected: true }),
    },
    {
      direction: 'request',
      url: `https://api.test${RPC_PATH}`,
      headers: { 'content-type': 'application/proto' },
      bodyBase64: framedPayload(payload).toString('base64'),
    },
    {
      direction: 'response',
      url: `https://api.test${RPC_PATH}`,
      headers: {
        'content-type': 'application/proto',
        'content-encoding': 'gzip',
      },
      bodyBase64: gzipBody,
    },
    {
      direction: 'request',
      url: `https://api.test${RPC_PATH}`,
      headers: { 'content-type': 'application/proto' },
    },
    {
      direction: 'response',
      url: 'https://api.test/aiserver.v1.UnknownService/Unknown',
      headers: { 'content-type': 'application/proto' },
      bodyBase64: Buffer.from([1]).toString('base64'),
    },
    {
      direction: 'request',
      url: `https://api.test${RPC_PATH}`,
      headers: { 'content-type': 'text/plain' },
      body: 'text',
    },
    {
      direction: 'response',
      url: 'https://api.test/not-connect',
      headers: { 'content-type': 'text/plain' },
      body: 'ignored',
    },
  ];
  fs.writeFileSync(
    path.join(logDir, 'proxy-test.jsonl'),
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\ninvalid-json\n`
  );
  fs.writeFileSync(path.join(logDir, 'empty.jsonl'), '');

  try {
    const report = verifyLogs(logDir, rpcMap);
    assert.deepEqual(report.files, ['empty.jsonl', 'proxy-test.jsonl']);
    assert.equal(report.totalEntries, 7);
    assert.equal(report.skippedNoBody, 1);
    assert.equal(report.skippedNonConnect, 1);
    assert.equal(report.base64Bodies, 2);
    assert.equal(report.insightBilling, 1);
    assert.equal(report.insightTokens, 1);
    assert.equal(report.insightContext, 1);
    assert.equal(report.insightAgent, 1);

    const request = report.byMethod.get('TestMethod:request');
    assert.deepEqual(request && request.ok, 3);
    assert.deepEqual(request && request.fail, 1);
    assert.deepEqual(request && request.json, 1);
    assert.deepEqual(request && request.gzip, 0);

    const response = report.byMethod.get('TestMethod:response');
    assert.deepEqual(response && response.ok, 1);
    assert.deepEqual(response && response.fail, 1);
    assert.deepEqual(response && response.json, 1);
    assert.deepEqual(response && response.gzip, 1);

    const unknown = report.byMethod.get('Unknown:response');
    assert.deepEqual(unknown && unknown.fail, 1);
  } finally {
    fs.rmSync(logDir, { recursive: true, force: true });
  }
});
