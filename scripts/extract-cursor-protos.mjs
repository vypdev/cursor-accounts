#!/usr/bin/env node
/**
 * Extract protobuf schemas from a local Cursor.app install.
 *
 * Reads @bufbuild/protobuf descriptors in extensionHostProcess.js.
 *
 * Usage:
 *   node scripts/extract-cursor-protos.mjs [path/to/Cursor.app]
 *
 * Output:
 *   proto/aiserver/v1/aiserver.proto
 *   proto/agent/v1/agent.proto
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

/** @type {Array<{ packageId: string, fileName: string, goPackage: string, imports?: string[] }>} */
const OUTPUT_PACKAGES = [
  {
    packageId: 'agent.v1',
    fileName: 'agent.proto',
    goPackage: 'cursor/gen/agent/v1;agentv1',
  },
  {
    packageId: 'aiserver.v1',
    fileName: 'aiserver.proto',
    goPackage: 'cursor/gen/aiserver/v1;aiserverv1',
  },
];

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

/**
 * @param {string} fullTypeName
 * @param {string} packageId
 */
function localTypeName(fullTypeName, packageId) {
  return fullTypeName.slice(packageId.length + 1).replace(/\./g, '_');
}

/**
 * Proto field type reference (same or cross-package).
 * @param {string} fullTypeName
 * @param {string} packageId
 */
function fieldTypeRef(fullTypeName, packageId) {
  const pkg = fullTypeName.split('.').slice(0, 2).join('.');
  const local = localTypeName(fullTypeName, pkg);
  if (pkg === packageId) {
    return local;
  }
  return `${pkg}.${local}`;
}

/**
 * @param {string} cursorAppPath
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
  /** @type {Map<string, { methods: Array<{ name: string, I: string, O: string, kind: string }> }>} */
  const services = new Map();

  const packagePrefixes = OUTPUT_PACKAGES.map((p) => p.packageId).join('|');

  const classRe = new RegExp(
    `(\\w+)=class \\w+ extends \\w+\\{[\\s\\S]*?typeName="((${packagePrefixes})\\.[^"]+)"[\\s\\S]*?newFieldList\\(\\(\\)=>\\[([\\s\\S]*?)\\]\\)\\}`,
    'g'
  );
  for (const m of bundle.matchAll(classRe)) {
    symToType.set(m[1], m[2]);
    if (!messageFieldsBlob.has(m[2])) {
      messageFieldsBlob.set(m[2], m[4]);
    }
  }

  const typeNameAssignRe = new RegExp(
    `(\\w+)\\.typeName="((${packagePrefixes})\\.[^"]+)"`,
    'g'
  );
  for (const m of bundle.matchAll(typeNameAssignRe)) {
    symToType.set(m[1], m[2]);
  }

  const quotedTypeRe = new RegExp(
    `"typeName":"((${packagePrefixes})\\.[^"]+)"`,
    'g'
  );
  for (const m of bundle.matchAll(quotedTypeRe)) {
    if (!messageFieldsBlob.has(m[1])) {
      messageFieldsBlob.set(m[1], '');
    }
  }

  const enumRe = /\.util\.setEnumType\((\w+),"([^"]+)",\[([\s\S]*?)\]\)/g;
  for (const m of bundle.matchAll(enumRe)) {
    const sym = m[1];
    const fullName = m[2];
    const pkg = OUTPUT_PACKAGES.find((p) => fullName.startsWith(`${p.packageId}.`));
    if (!pkg) {
      continue;
    }
    symToType.set(sym, fullName);
    if (!enumValues.has(fullName)) {
      enumValues.set(
        fullName,
        [...m[3].matchAll(/name:"([^"]+)"/g)].map((v) => v[1])
      );
    }
  }

  const serviceRe = new RegExp(
    `typeName:"((${packagePrefixes})\\.[A-Za-z0-9_]+Service)",methods:\\{([\\s\\S]*?)\\}\\}`,
    'g'
  );
  for (const m of bundle.matchAll(serviceRe)) {
    const methods = [];
    const methodRe =
      /\w+:\{name:"([^"]+)",I:(\w+),O:(\w+),kind:p\.(\w+)\}/g;
    for (const mm of m[3].matchAll(methodRe)) {
      methods.push({
        name: mm[1],
        I: mm[2],
        O: mm[3],
        kind: mm[4],
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
 * @param {string} packageId
 */
function fieldToProto(fieldStr, symToType, packageId) {
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

  const resolveType = (sym) => {
    const full = sym ? symToType.get(sym) : undefined;
    if (!full) {
      return { label: 'bytes', comment: sym };
    }
    return { label: fieldTypeRef(full, packageId), comment: null };
  };

  if (kind === 'message') {
    const sym = fieldStr.match(/,T:(\w+)/)?.[1];
    const { label, comment } = resolveType(sym);
    const note = comment ? ` // unresolved symbol ${comment}` : '';
    return `${prefix}${label} ${name} = ${no};${note}`;
  }

  if (kind === 'enum') {
    const enumSym =
      fieldStr.match(/getEnumType\((\w+)\)/)?.[1] ??
      fieldStr.match(/,T:(\w+)/)?.[1];
    const { label, comment } = resolveType(enumSym);
    const typeLabel = comment ? 'int32' : label;
    const note = comment ? ` // unresolved enum ${comment}` : '';
    return `${prefix}${typeLabel} ${name} = ${no};${note}`;
  }

  return `${prefix}bytes ${name} = ${no};`;
}

/**
 * @param {ReturnType<typeof extractDescriptors>} descriptors
 * @param {{ packageId: string, fileName: string, goPackage: string, imports?: string[] }} pkg
 */
function generateProto(descriptors, pkg) {
  const { symToType, messageFieldsBlob, enumValues, services } = descriptors;
  const prefix = pkg.packageId;
  const lines = [];

  lines.push('// Generated by scripts/extract-cursor-protos.mjs — do not edit by hand.');
  lines.push('// Source: Cursor extensionHostProcess.js (@bufbuild/protobuf descriptors)');
  lines.push('syntax = "proto3";');
  lines.push(`package ${prefix};`);
  lines.push(`option go_package = "${pkg.goPackage}";`);
  if (pkg.imports?.length) {
    for (const imp of pkg.imports) {
      lines.push(`import "${imp}";`);
    }
  }
  lines.push('');

  const inPackage = (fullName) => fullName.startsWith(`${prefix}.`);

  for (const [fullName, values] of [...enumValues.entries()]
    .filter(([n]) => inPackage(n))
    .sort((a, b) => a[0].localeCompare(b[0]))) {
    const name = localTypeName(fullName, prefix);
    lines.push(`enum ${name} { // ${fullName}`);
    values.forEach((v, i) => {
      const prefixed =
        v.startsWith(`${name}_`) || v.startsWith(`${name.toUpperCase()}_`)
          ? v
          : `${name}_${v}`;
      lines.push(`  ${prefixed} = ${i};`);
    });
    lines.push('}');
    lines.push('');
  }

  for (const [fullName, blob] of [...messageFieldsBlob.entries()]
    .filter(([n]) => inPackage(n))
    .sort((a, b) => a[0].localeCompare(b[0]))) {
    const name = localTypeName(fullName, prefix);
    lines.push(`message ${name} { // ${fullName}`);
    for (const part of splitFields(blob)) {
      const line = fieldToProto(part, symToType, prefix);
      if (line) lines.push(`  ${line}`);
    }
    lines.push('}');
    lines.push('');
  }

  for (const [fullName, svc] of [...services.entries()]
    .filter(([n]) => inPackage(n))
    .sort((a, b) => a[0].localeCompare(b[0]))) {
    const name = localTypeName(fullName, prefix);
    lines.push(`service ${name} { // ${fullName}`);
    for (const method of svc.methods) {
      const inType = symToType.get(method.I);
      const outType = symToType.get(method.O);
      if (!inType || !outType) {
        lines.push(`  // rpc ${method.name} skipped (unresolved request/response types)`);
        continue;
      }
      const inName = fieldTypeRef(inType, prefix);
      const outName = fieldTypeRef(outType, prefix);
      let returns = outName;
      if (method.kind === 'ServerStreaming' || method.kind === 'BiDiStreaming') {
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
    console.error(
      'Pass Cursor.app path: node scripts/extract-cursor-protos.mjs /Applications/Cursor.app'
    );
    process.exit(1);
  }

  console.error(`Reading ${hostPath}`);
  const bundle = fs.readFileSync(hostPath, 'utf8');
  const descriptors = extractDescriptors(bundle);

  console.error(
    `Parsed ${descriptors.symToType.size} symbols, ${descriptors.messageFieldsBlob.size} messages, ${descriptors.enumValues.size} enums, ${descriptors.services.size} services`
  );

  const version = readCursorVersion(cursorApp);

  for (const pkg of OUTPUT_PACKAGES) {
    const [ns, ver] = pkg.packageId.split('.');
    const outDir = path.join(REPO_ROOT, 'proto', ns, ver);
    fs.mkdirSync(outDir, { recursive: true });
    const protoPath = path.join(outDir, pkg.fileName);
    fs.writeFileSync(protoPath, generateProto(descriptors, pkg), 'utf8');
    console.error(`Wrote ${protoPath}`);
  }

  const versionPath = path.join(REPO_ROOT, 'proto', 'aiserver', 'v1', 'cursor-version.txt');
  fs.writeFileSync(
    versionPath,
    `${version}\nextractedAt=${new Date().toISOString()}\nsource=${hostPath}\n`,
    'utf8'
  );
  console.error(`Wrote ${versionPath} (Cursor ${version})`);
}

main();
