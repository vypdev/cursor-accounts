import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createExtractionPlan,
  defaultCursorAppPath,
  extractCursorProtos,
  readCursorVersion,
  resolveExtensionHostPath,
} from './cursor-proto-extraction.mjs';
import { extractDescriptors, fieldToProto, splitFields } from './lib/cursor-proto-descriptors.mjs';
import { OUTPUT_PACKAGES } from './lib/cursor-proto-config.mjs';
import { generateProto } from './lib/cursor-proto-renderer.mjs';

function descriptorBundle() {
  return [
    'Req=class X extends Y{typeName="agent.v1.Request"newFieldList(()=>[{no:1,name:"count",kind:"scalar",T:5,repeated:!0},{no:2,name:"status",kind:"enum",T:Status},{no:3,name:"child",kind:"message",T:Child}])}',
    'Child=class X extends Y{typeName="agent.v1.Child"newFieldList(()=>[])}',
    'Res=class X extends Y{typeName="agent.v1.Response"newFieldList(()=>[])}',
    'External=class X extends Y{typeName="aiserver.v1.External"newFieldList(()=>[])}',
    'Status=class X extends Y{typeName="agent.v1.Status"newFieldList(()=>[])}',
    '.util.setEnumType(Status,"agent.v1.Status",[{name:"UNKNOWN"},{name:"READY"}])',
    'typeName:"agent.v1.AgentService",methods:{run:{name:"Run",I:Req,O:Res,kind:p.Unary},stream:{name:"Stream",I:Req,O:Res,kind:p.BiDiStreaming}}}',
    'typeName:"aiserver.v1.BidiService",methods:{}}',
    'Quoted={"typeName":"agent.v1.Empty"}',
  ].join('\n');
}

function currentDescriptorBundle() {
  return [
    'CurrentReq=r.makeMessageType("agent.v1.CurrentRequest",()=>[{no:1,name:"prompt",kind:"scalar",T:9}])',
    'CurrentRes=r.makeMessageType("agent.v1.CurrentResponse",()=>[{no:1,name:"result",kind:"scalar",T:9}])',
    'CurrentMode=r.makeMessageType("agent.v1.CurrentMode",()=>[])',
    'CurrentMode=r.makeEnum("agent.v1.CurrentMode",[{no:0,name:"MODE_UNSPECIFIED",localName:"UNSPECIFIED"},{no:7,name:"MODE_FAST",localName:"FAST"}])',
    'currentService={typeName:"agent.v1.CurrentService",methods:{run:{name:"Run",I:CurrentReq,O:CurrentRes,kind:u.ServerStreaming}}}',
  ].join('\n');
}

test('extractDescriptors parses legacy and current Cursor descriptor formats', () => {
  const descriptors = extractDescriptors(`${descriptorBundle()}\n${currentDescriptorBundle()}`);

  assert.equal(descriptors.symToType.get('Req'), 'agent.v1.Request');
  assert.equal(descriptors.messageFieldsBlob.get('agent.v1.Request')?.includes('count'), true);
  assert.deepEqual(descriptors.enumValues.get('agent.v1.Status'), [
    { name: 'UNKNOWN', number: 0 },
    { name: 'READY', number: 1 },
  ]);
  assert.deepEqual(descriptors.services.get('agent.v1.AgentService')?.methods, [
    { name: 'Run', I: 'Req', O: 'Res', kind: 'Unary' },
    { name: 'Stream', I: 'Req', O: 'Res', kind: 'BiDiStreaming' },
  ]);
  assert.deepEqual(descriptors.services.get('aiserver.v1.BidiService')?.methods, []);
  assert.equal(descriptors.messageFieldsBlob.has('agent.v1.Empty'), true);
  assert.equal(descriptors.symToType.get('CurrentReq'), 'agent.v1.CurrentRequest');
  assert.deepEqual(descriptors.enumValues.get('agent.v1.CurrentMode'), [
    { name: 'MODE_UNSPECIFIED', number: 0 },
    { name: 'MODE_FAST', number: 7 },
  ]);
  assert.deepEqual(descriptors.services.get('agent.v1.CurrentService')?.methods, [
    { name: 'Run', I: 'CurrentReq', O: 'CurrentRes', kind: 'ServerStreaming' },
  ]);
});

test('field helpers preserve nested descriptors and resolve field kinds', () => {
  assert.deepEqual(splitFields('first:{nested:{value:1}},second:{value:2},third'), [
    'first:{nested:{value:1}}',
    'second:{value:2}',
    'third',
  ]);

  const symbols = new Map([
    ['Child', 'agent.v1.Child'],
    ['External', 'aiserver.v1.External'],
    ['Status', 'agent.v1.Status'],
  ]);
  assert.equal(
    fieldToProto('no:1,name:"count",kind:"scalar",T:5,repeated:!0', symbols, 'agent.v1'),
    'repeated int32 count = 1;'
  );
  assert.equal(
    fieldToProto('no:2,name:"child",kind:"message",T:Child', symbols, 'agent.v1'),
    'Child child = 2;'
  );
  assert.equal(
    fieldToProto('no:3,name:"external",kind:"message",T:External', symbols, 'agent.v1'),
    'aiserver.v1.External external = 3;'
  );
  assert.equal(
    fieldToProto('no:4,name:"status",kind:"enum",getEnumType(Status)', symbols, 'agent.v1'),
    'Status status = 4;'
  );
  assert.equal(
    fieldToProto('no:5,name:"unknown",kind:"message",T:Missing', symbols, 'agent.v1'),
    'bytes unknown = 5; // unresolved symbol Missing'
  );
  assert.equal(fieldToProto('missing-name', symbols, 'agent.v1'), null);
});

test('generateProto renders sorted enums, messages, streaming methods, and patches', () => {
  const output = generateProto(extractDescriptors(descriptorBundle()), OUTPUT_PACKAGES[0]);

  assert.match(output, /enum Status \{[\s\S]*Status_UNKNOWN = 0;[\s\S]*Status_READY = 1;/);
  assert.match(output, /message Request \{[\s\S]*repeated int32 count = 1;/);
  assert.match(output, /service AgentService \{[\s\S]*rpc Run\(Request\) returns \(Response\)/);
  assert.match(
    output,
    /rpc Stream\(stream Request\) returns \(stream Response\)/
  );

  const patchedOutput = generateProto(extractDescriptors(descriptorBundle()), OUTPUT_PACKAGES[1]);
  assert.match(
    patchedOutput,
    /service BidiService \{[\s\S]*rpc BidiAppend\(BidiAppendRequest\) returns \(BidiAppendResponse\)/
  );
});

test('platform path and version adapters are deterministic and shell-safe', () => {
  assert.equal(defaultCursorAppPath('darwin'), '/Applications/Cursor.app');
  assert.equal(
    defaultCursorAppPath('win32', { LOCALAPPDATA: 'C:\\Users\\test' }),
    'C:\\Users\\test\\Programs\\Cursor\\Cursor.exe'
  );
  assert.equal(defaultCursorAppPath('linux'), '/usr/share/cursor');
  assert.equal(
    resolveExtensionHostPath('C:\\Users\\test\\Cursor.exe', 'win32'),
    'C:\\Users\\test\\resources\\app\\out\\vs\\workbench\\api\\node\\extensionHostProcess.js'
  );

  const calls = [];
  const version = readCursorVersion('/tmp/Cursor "quoted".app', {
    platform: 'darwin',
    runCommand: (...args) => {
      calls.push(args);
      return '0.50.1\n';
    },
  });
  assert.equal(version, '0.50.1');
  assert.deepEqual(calls[0]?.slice(0, 2), [
    'plutil',
    ['-extract', 'CFBundleShortVersionString', 'raw', '/tmp/Cursor "quoted".app/Contents/Info.plist'],
  ]);
});

test('extractCursorProtos writes a complete compatible output plan', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-accounts-protos-'));
  const cursorApp = path.join(root, 'Cursor.app');
  const repoRoot = path.join(root, 'repo');
  const hostPath = resolveExtensionHostPath(cursorApp, 'darwin');
  try {
    fs.mkdirSync(path.dirname(hostPath), { recursive: true });
    fs.writeFileSync(hostPath, descriptorBundle(), 'utf8');
    const result = extractCursorProtos({
      cursorAppPath: cursorApp,
      repoRoot,
      platform: 'linux',
      now: () => '2026-08-26T00:00:00.000Z',
      log: () => {},
    });

    assert.equal(result.files.length, 3);
    assert.match(
      fs.readFileSync(path.join(repoRoot, 'proto', 'agent', 'v1', 'agent.proto'), 'utf8'),
      /package agent\.v1;/
    );
    assert.equal(
      fs.readFileSync(path.join(repoRoot, 'proto', 'aiserver', 'v1', 'cursor-version.txt'), 'utf8'),
      `unknown\nextractedAt=2026-08-26T00:00:00.000Z\nsource=${hostPath}\n`
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('createExtractionPlan keeps generated files deterministic for a fixed timestamp', () => {
  const descriptors = extractDescriptors(descriptorBundle());
  const first = createExtractionPlan({
    repoRoot: '/repo',
    hostPath: '/Cursor.app/extensionHostProcess.js',
    descriptors,
    cursorVersion: '0.50.1',
    extractedAt: '2026-08-26T00:00:00.000Z',
  });
  const second = createExtractionPlan({
    repoRoot: '/repo',
    hostPath: '/Cursor.app/extensionHostProcess.js',
    descriptors,
    cursorVersion: '0.50.1',
    extractedAt: '2026-08-26T00:00:00.000Z',
  });
  assert.deepEqual(first, second);
});
