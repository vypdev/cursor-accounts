import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
  analyzeProxyFiles,
  decodeProxyEntry,
  MAX_INSIGHT_SAMPLES,
  resolveProxyLogFiles,
} from './lib/proxy-traffic-analysis.mjs';

const RPC_PATH = '/agent.v1.AgentService/RunPoll';
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

function createFakeType() {
  return {
    decode(payload) {
      if (payload.length === 2 && payload[0] === 8 && payload[1] === 1) {
        return { decoded: true };
      }
      throw new Error('invalid test payload');
    },
    toObject() {
      return { requestId: 'outer-request', data: 'inner-payload' };
    },
  };
}

function framedPayload(payload) {
  const frame = Buffer.alloc(5 + payload.length);
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

test('resolveProxyLogFiles returns deterministic file and log-directory boundaries', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-accounts-analysis-'));
  try {
    fs.writeFileSync(path.join(directory, 'b.jsonl'), '');
    fs.writeFileSync(path.join(directory, 'a.jsonl'), '');
    fs.writeFileSync(path.join(directory, 'ignored.txt'), '');

    assert.deepEqual(resolveProxyLogFiles(directory), {
      files: [path.join(directory, 'a.jsonl'), path.join(directory, 'b.jsonl')],
      logDir: directory,
    });
    assert.deepEqual(resolveProxyLogFiles(path.join(directory, 'a.jsonl')), {
      files: [path.join(directory, 'a.jsonl')],
      logDir: directory,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('decodeProxyEntry handles JSON body fallbacks and gzip Connect protobuf framing', () => {
  const Type = createFakeType();
  const payload = Buffer.from([8, 1]);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-accounts-analysis-'));
  try {
    assert.deepEqual(
      decodeProxyEntry(
        {
          headers: { 'content-type': 'application/json' },
          bodyBase64: Buffer.from('{"known":true}').toString('base64'),
        },
        Type,
        directory
      ),
      { known: true }
    );
    assert.deepEqual(
      decodeProxyEntry(
        {
          headers: {
            'content-type': 'application/proto',
            'content-encoding': 'gzip',
          },
          bodyBase64: zlib.gzipSync(framedPayload(payload)).toString('base64'),
        },
        Type,
        directory
      ),
      { requestId: 'outer-request', data: 'inner-payload' }
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('analyzeProxyFiles aggregates decoded RPCs and nested token insights', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-accounts-analysis-'));
  const file = path.join(directory, 'capture.jsonl');
  const Type = createFakeType();
  const rpcMap = new Map([[RPC_PATH, { requestType: Type, responseType: Type }]]);
  const entries = [
    {
      direction: 'request',
      url: `https://api.test${RPC_PATH}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputTokens: 2, outputTokens: 3 }),
    },
    {
      direction: 'response',
      url: `https://api.test${RPC_PATH}`,
      headers: { 'content-type': 'application/proto' },
      bodyBase64: framedPayload(Buffer.from([8, 1])).toString('base64'),
    },
    {
      direction: 'response',
      url: 'https://api.test/agent.v1.AgentService/Unknown',
      headers: { 'content-type': 'application/proto' },
      bodyBase64: Buffer.from([8, 1]).toString('base64'),
    },
    {
      direction: 'request',
      url: `https://api.test${RPC_PATH}`,
      headers: { 'content-type': 'application/json' },
      body: '{invalid',
    },
    {
      direction: 'request',
      url: 'https://api.test/not-connect',
      headers: { 'content-type': 'text/plain' },
      body: 'ignored',
    },
    { direction: 'error', url: `https://api.test${RPC_PATH}` },
  ];
  fs.writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

  try {
    const report = await analyzeProxyFiles(
      [file],
      directory,
      rpcMap,
      {
        decodeInner: async (outer) =>
          outer.data ? { interactionUpdate: { tokenDelta: { tokens: 17 } } } : null,
      }
    );

    assert.equal(report.total, 4);
    assert.equal(report.decoded, 2);
    assert.equal(report.interactiveDecoded, 2);
    assert.equal(report.insights, 2);
    assert.equal(report.agentTokenEvents, 1);
    assert.deepEqual(report.byMethod.get('agent.v1.AgentService/RunPoll:request'), 1);
    assert.deepEqual(report.byMethod.get('agent.v1.AgentService/RunPoll:response'), 1);
    assert.equal(report.insightSamples.length, 2);
    assert.equal(report.insightSamples[1].tokens.totalTokens, 17);
    assert.equal(report.insightSamples.length <= MAX_INSIGHT_SAMPLES, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('analyze-proxy-traffic CLI starts with an empty log directory', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'cursor-accounts-analysis-cli-')
  );
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(SCRIPT_DIRECTORY, 'analyze-proxy-traffic.mjs'), directory],
      { encoding: 'utf8' }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.error, undefined);
    assert.match(result.stdout, /Files: 0/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
