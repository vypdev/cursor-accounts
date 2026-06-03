#!/usr/bin/env node
/**
 * Extract aiserver.v1 protobuf schemas from a local Cursor.app install.
 *
 * Reads the bundled @bufbuild/protobuf descriptors in:
 *   Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js
 *
 * Usage:
 *   node scripts/extract-cursor-protos.mjs [path/to/Cursor.app]
 *   CURSOR_APP=/Applications/Cursor.app node scripts/extract-cursor-protos.mjs
 *
 * Output:
 *   proto/aiserver/v1/aiserver.proto
 *   proto/aiserver/v1/cursor-version.txt
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_CURSOR_APP =
  process.platform === 'darwin'
    ? '/Applications/Cursor.app'
    : process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Cursor', 'Cursor.exe')
      : '/usr/share/cursor';

const EXTENSION_HOST_REL = path.join(
  'Contents',
  'Resources',
  'app',
  'out',
  'vs',
  'workbench',
  'api',
  'node',
  'extensionHostProcess.js'
);

const SCALAR = new Map([
  [1, 'double'],
  [2, 'float'],
  [3, 'int64'],
  [4, 'uint64'],
  [5, 'int32'],
  [6, 'fixed64'],
  [7, 'fixed32'],
  [8, 'bool'],
  [9, 'string'],
  [12, 'bytes'],
  [13, 'uint32'],
  [15, 'sfixed32'],
  [16, 'sfixed64'],
  [17, 'sint32'],
  [18, 'sint64'],
]);

/** @param {string} fullTypeName */
function messageName(fullTypeName) {
  return fullTypeName.replace(/^aiserver\.v1\./, '').replace(/\./g, '_');
}

/**
 * @param {string} cursorAppPath
 * @returns {string}
 */
function resolveExtensionHostPath(cursorAppPath) {
  if (process.platform === 'win32') {
    const exe = cursorAppPath.endsWith('.exe') ? cursorAppPath : `${cursorAppPath}.exe`;
    const dir = path.dirname(exe);
    return path.join(dir, 'resources', 'app', ...EXTENSION_HOST_REL.split(path.sep).slice(4));
  }
  return path.join(cursorAppPath, EXTENSION_HOST_REL);
}

/**
 * @param {string} cursorAppPath
 */
function readCursorVersion(cursorAppPath) {
  if (process.platform !== 'darwin') {
    return 'unknown';
  }
  const plist = path.join(cursorAppPath, 'Contents', 'Info.plist');
  try {
    return execSync(`plutil -extract CFBundleShortVersionString raw "${plist}"`, {
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * @param {string} bundle
 */
function extractDescriptors(bundle) {
  /** @type {Map<string, string>} */
  const symToType = new Map();
  /** @type {Map<string, string>} */
  const messageFieldsBlob = new Map();
  /** @type {Map<string, string[]>} */
  const enumValues = new Map();
  /** @type {Map<string, { methods: Array<{ jsName: string, name: string, I: string, O: string, kind: string }> }>} */
  const services = new Map();

  const classRe =
    /(\w+)=class \w+ extends \w+\{[\s\S]*?typeName="(aiserver\.v1\.[^"]+)"[\s\S]*?newFieldList\(\(\)=>\[([\s\S]*?)\]\)\}/g;
  for (const m of bundle.matchAll(classRe)) {
    symToType.set(m[1], m[2]);
    if (!messageFieldsBlob.has(m[2])) {
      messageFieldsBlob.set(m[2], m[3]);
    }
  }

  const enumRe = /\.util\.setEnumType\(\w+,"(aiserver\.v1\.[^"]+)",\[([\s\S]*?)\]\)/g;
  for (const m of bundle.matchAll(enumRe)) {
    if (!enumValues.has(m[1])) {
      enumValues.set(
        m[1],
        [...m[2].matchAll(/name:"([^"]+)"/g)].map((v) => v[1])
      );
    }
  }

  const serviceRe =
    /typeName:"(aiserver\.v1\.[A-Za-z0-9_]+Service)",methods:\{([\s\S]*?)\}\}/g;
  for (const m of bundle.matchAll(serviceRe)) {
    const methods = [];
    const methodRe =
      /(\w+):\{name:"([^"]+)",I:(\w+),O:(\w+),kind:p\.(\w+)\}/g;
    for (const mm of m[2].matchAll(methodRe)) {
      methods.push({
        jsName: mm[1],
        name: mm[2],
        I: mm[3],
        O: mm[4],
        kind: mm[5],
      });
    }
    services.set(m[1], { methods });
  }

  return { symToType, messageFieldsBlob, enumValues, services };
}

/**
 * @param {string} fieldsBlob
 */
function splitFields(fieldsBlob) {
  if (!fieldsBlob.trim()) {
    return [];
  }
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < fieldsBlob.length; i++) {
    const ch = fieldsBlob[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(fieldsBlob.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(fieldsBlob.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * @param {string} fieldStr
 * @param {Map<string, string>} symToType
 */
function fieldToProto(fieldStr, symToType) {
  const no = fieldStr.match(/no:(\d+)/)?.[1];
  const name = fieldStr.match(/name:"([^"]+)"/)?.[1];
  if (!no || !name) {
    return null;
  }

  const repeated = fieldStr.includes('repeated:!0');
  const opt = fieldStr.includes('opt:!0');
  let prefix = '';
  if (repeated) prefix = 'repeated ';
  else if (opt) prefix = 'optional ';

  const kind = fieldStr.match(/kind:"([^"]+)"/)?.[1] ?? 'scalar';

  if (kind === 'scalar') {
    const scalarNo = Number(fieldStr.match(/,T:(\d+)/)?.[1] ?? 12);
    const scalar = SCALAR.get(scalarNo) ?? 'bytes';
    return `${prefix}${scalar} ${name} = ${no};`;
  }

  if (kind === 'message' || kind === 'enum') {
    const sym = fieldStr.match(/,T:(\w+)/)?.[1];
    const full = sym ? symToType.get(sym) : undefined;
    const typeLabel = full ? messageName(full) : (sym ?? 'bytes');
    return `${prefix}${typeLabel} ${name} = ${no};`;
  }

  return `${prefix}bytes ${name} = ${no};`;
}

/**
 * @param {ReturnType<typeof extractDescriptors>} descriptors
 */
function generateProto(descriptors) {
  const { symToType, messageFieldsBlob, enumValues, services } = descriptors;
  const lines = [];

  lines.push('// Generated by scripts/extract-cursor-protos.mjs — do not edit by hand.');
  lines.push('// Source: Cursor extensionHostProcess.js (@bufbuild/protobuf descriptors)');
  lines.push('syntax = "proto3";');
  lines.push('package aiserver.v1;');
  lines.push('option go_package = "cursor/gen/aiserver/v1;aiserverv1";');
  lines.push('');

  for (const [fullName, values] of [...enumValues.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const name = messageName(fullName);
    lines.push(`enum ${name} { // ${fullName}`);
    values.forEach((v, i) => {
      lines.push(`  ${v} = ${i};`);
    });
    lines.push('}');
    lines.push('');
  }

  for (const [fullName, blob] of [...messageFieldsBlob.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const name = messageName(fullName);
    lines.push(`message ${name} { // ${fullName}`);
    for (const part of splitFields(blob)) {
      const line = fieldToProto(part, symToType);
      if (line) lines.push(`  ${line}`);
    }
    lines.push('}');
    lines.push('');
  }

  for (const [fullName, svc] of [...services.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const name = messageName(fullName);
    lines.push(`service ${name} { // ${fullName}`);
    for (const method of svc.methods) {
      const inType = symToType.get(method.I);
      const outType = symToType.get(method.O);
      const inName = inType ? messageName(inType) : method.I;
      const outName = outType ? messageName(outType) : method.O;
      let returns = outName;
      if (method.kind === 'ServerStreaming') {
        returns = `stream ${outName}`;
      } else if (method.kind === 'BiDiStreaming') {
        returns = `stream ${outName}`;
      }
      let params = inName;
      if (method.kind === 'BiDiStreaming') {
        params = `stream ${inName}`;
      }
      lines.push(`  rpc ${method.name}(${params}) returns (${returns}) {}`);
    }
    lines.push('}');
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  const cursorApp = path.resolve(
    process.argv[2] ?? process.env.CURSOR_APP ?? DEFAULT_CURSOR_APP
  );
  const hostPath = resolveExtensionHostPath(cursorApp);

  if (!fs.existsSync(hostPath)) {
    console.error(`extensionHostProcess.js not found:\n  ${hostPath}`);
    console.error('Pass Cursor.app path: node scripts/extract-cursor-protos.mjs /Applications/Cursor.app');
    process.exit(1);
  }

  console.error(`Reading ${hostPath}`);
  const bundle = fs.readFileSync(hostPath, 'utf8');
  const descriptors = extractDescriptors(bundle);

  console.error(
    `Parsed ${descriptors.symToType.size} symbols, ${descriptors.messageFieldsBlob.size} messages, ${descriptors.enumValues.size} enums, ${descriptors.services.size} services`
  );

  const proto = generateProto(descriptors);
  const outDir = path.join(REPO_ROOT, 'proto', 'aiserver', 'v1');
  fs.mkdirSync(outDir, { recursive: true });

  const protoPath = path.join(outDir, 'aiserver.proto');
  fs.writeFileSync(protoPath, proto, 'utf8');

  const version = readCursorVersion(cursorApp);
  const versionPath = path.join(outDir, 'cursor-version.txt');
  fs.writeFileSync(
    versionPath,
    `${version}\nextractedAt=${new Date().toISOString()}\nsource=${hostPath}\n`,
    'utf8'
  );

  console.error(`Wrote ${protoPath}`);
  console.error(`Wrote ${versionPath} (Cursor ${version})`);
}

main();
