#!/usr/bin/env node
/**
 * Verify extracted protos against MITM proxy JSONL captures.
 *
 * Usage:
 *   node scripts/verify-proto-jsonl.mjs [log-dir]
 *   pnpm run verify:proto-jsonl
 */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PROTO_FILES = [
  path.join(REPO_ROOT, 'proto', 'agent', 'v1', 'agent.proto'),
  path.join(REPO_ROOT, 'proto', 'aiserver', 'v1', 'aiserver.proto'),
];

const DEFAULT_LOG_DIR = path.join(
  process.env.HOME ?? '',
  '.cursor-accounts',
  'proxy',
  'logs'
);

const RPC_PATH_RE =
  /aiserver\.v1\.([A-Za-z0-9_]+Service)\/([A-Za-z0-9_]+)/;

/**
 * @param {Buffer} body
 * @returns {Buffer[]}
 */
function connectPayloadCandidates(body) {
  const candidates = [body];
  if (body.length >= 5 && body[0] === 0) {
    const len = body.readUInt32BE(1);
    if (body.length >= 5 + len) {
      candidates.push(body.subarray(5, 5 + len));
    }
  }
  if (body.length >= 3 && body[0] === 0) {
    const len = body.readUInt16BE(1);
    if (body.length >= 3 + len) {
      candidates.push(body.subarray(3, 3 + len));
    }
  }
  return [...new Set(candidates)];
}

/**
 * @param {Buffer} raw
 * @param {string} contentEncoding
 */
function prepareBody(raw, contentEncoding) {
  if (contentEncoding.includes('gzip')) {
    try {
      return zlib.gunzipSync(raw);
    } catch {
      // logged body may be UTF-8-mangled gzip
    }
  }
  return raw;
}

/**
 * @param {protobuf.Type} Type
 * @param {Buffer} raw
 * @param {string} contentEncoding
 */
function tryDecodeProto(Type, raw, contentEncoding = '') {
  raw = prepareBody(raw, contentEncoding);
  let lastErr;
  for (const payload of connectPayloadCandidates(raw)) {
    try {
      const msg = Type.decode(payload);
      return {
        ok: true,
        object: Type.toObject(msg, {
          longs: String,
          enums: String,
          bytes: String,
          defaults: false,
        }),
        payloadLen: payload.length,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  return { ok: false, error: lastErr?.message ?? 'decode failed' };
}

/**
 * @param {string} method
 * @param {'request' | 'response'} direction
 */
function messageTypeName(method, direction) {
  const suffix = direction === 'request' ? 'Request' : 'Response';
  return `aiserver.v1.${method}${suffix}`;
}

/**
 * @param {string} url
 */
function parseRpc(url) {
  const m = String(url).match(RPC_PATH_RE);
  if (!m) return null;
  return { service: m[1], method: m[2] };
}

/**
 * @param {Record<string, unknown>} obj
 * @param {protobuf.Type} Type
 */
function jsonKeysMatchProto(obj, Type) {
  const protoFields = new Set(
    Type.fieldsArray.map((f) => f.name).filter(Boolean)
  );
  const jsonKeys = Object.keys(obj).filter(
    (k) => obj[k] !== undefined && obj[k] !== null
  );
  const unknown = jsonKeys.filter((k) => !protoFields.has(k));
  const missing = [...protoFields].filter(
    (k) => !(k in obj) && !k.startsWith('_')
  );
  return { unknown, missing: missing.slice(0, 8), protoFieldCount: protoFields.size };
}

/**
 * @param {string} logDir
 * @param {protobuf.Root} root
 */
function verifyLogs(logDir, root) {
  /** @type {Map<string, { ok: number, fail: number, json: number, gzip: number, samples: string[] }>} */
  const byMethod = new Map();
  /** @type {Map<string, { ok: number, fail: number }>} */
  const dashboard = new Map();
  let totalEntries = 0;
  let skippedNoBody = 0;
  let skippedNonAiserver = 0;

  const files = fs
    .readdirSync(logDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();

  for (const file of files) {
    const filePath = path.join(logDir, file);
    if (fs.statSync(filePath).size === 0) continue;

    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.direction !== 'request' && entry.direction !== 'response') {
        continue;
      }
      const rpc = parseRpc(entry.url ?? '');
      if (!rpc) {
        skippedNonAiserver++;
        continue;
      }

      totalEntries++;
      const key = `${rpc.method}:${entry.direction}`;
      if (!byMethod.has(key)) {
        byMethod.set(key, { ok: 0, fail: 0, json: 0, gzip: 0, samples: [] });
      }
      const stats = byMethod.get(key);
      const dashKey = rpc.method;
      if (!dashboard.has(dashKey)) {
        dashboard.set(dashKey, { ok: 0, fail: 0 });
      }

      const ct = (entry.headers?.['content-type'] ?? '').toLowerCase();
      const enc = (entry.headers?.['content-encoding'] ?? '').toLowerCase();
      const typeName = messageTypeName(rpc.method, entry.direction);

      let Type;
      try {
        Type = root.lookupType(typeName);
      } catch {
        stats.fail++;
        dashboard.get(dashKey).fail++;
        if (stats.samples.length < 2) {
          stats.samples.push(`no type ${typeName} (${file})`);
        }
        continue;
      }

      const markDash = (ok) => {
        if (ok) dashboard.get(dashKey).ok++;
        else dashboard.get(dashKey).fail++;
      };

      if (!entry.body || entry.body.length === 0) {
        skippedNoBody++;
        stats.ok++;
        markDash(true);
        continue;
      }

      if (ct.includes('json')) {
        stats.json++;
        try {
          const obj = JSON.parse(entry.body);
          const { unknown } = jsonKeysMatchProto(obj, Type);
          if (unknown.length === 0) {
            stats.ok++;
            markDash(true);
          } else {
            stats.fail++;
            markDash(false);
            if (stats.samples.length < 2) {
              stats.samples.push(
                `JSON keys not in proto: ${unknown.slice(0, 5).join(', ')} (${file})`
              );
            }
          }
        } catch {
          stats.fail++;
          markDash(false);
          if (stats.samples.length < 2) {
            stats.samples.push(`JSON parse error (${file})`);
          }
        }
        continue;
      }

      if (!ct.includes('proto')) {
        stats.fail++;
        markDash(false);
        if (stats.samples.length < 2) {
          stats.samples.push(`unexpected content-type: ${ct || '(none)'} (${file})`);
        }
        continue;
      }

      if (enc.includes('gzip')) {
        stats.gzip++;
      }

      const raw = Buffer.from(entry.body, 'latin1');
      const result = tryDecodeProto(Type, raw, enc);
      if (result.ok) {
        stats.ok++;
        markDash(true);
        if (stats.samples.length < 1) {
          const keys = Object.keys(result.object).slice(0, 6).join(', ');
          stats.samples.push(
            `proto decode OK ${result.payloadLen}b fields: ${keys}${enc ? ' gzip' : ''} (${file})`
          );
        }
      } else {
        stats.fail++;
        markDash(false);
        if (stats.samples.length < 2) {
          const hint = enc.includes('gzip') ? ' [gzip body may be UTF-8 corrupted in JSONL]' : '';
          stats.samples.push(
            `${result.error} (${raw.length}b, ${file})${hint}`
          );
        }
      }
    }
  }

  return {
    files,
    byMethod,
    dashboard,
    totalEntries,
    skippedNoBody,
    skippedNonAiserver,
  };
}

async function main() {
  const logDir = path.resolve(process.argv[2] ?? DEFAULT_LOG_DIR);
  if (!fs.existsSync(logDir)) {
    console.error(`Log dir not found: ${logDir}`);
    process.exit(1);
  }

  console.log('Loading protos...');
  const root = await protobuf.load(PROTO_FILES);
  console.log(`Scanning ${logDir}\n`);

  const report = verifyLogs(logDir, root);
  const rows = [...report.byMethod.entries()].sort((a, b) => {
    const totalA = a[1].ok + a[1].fail + a[1].json;
    const totalB = b[1].ok + b[1].fail + b[1].json;
    return totalB - totalA;
  });

  let totalOk = 0;
  let totalFail = 0;
  let totalJson = 0;

  console.log(
    'Method:direction'.padEnd(42),
    'OK'.padStart(5),
    'FAIL'.padStart(5),
    'JSON'.padStart(5),
    'TOTAL'.padStart(6)
  );
  console.log('-'.repeat(68));

  for (const [key, s] of rows) {
    const total = s.ok + s.fail + s.json;
    totalOk += s.ok;
    totalFail += s.fail;
    totalJson += s.json;
    if (total === 0) continue;
    const mark = s.fail > 0 ? '!' : ' ';
    console.log(
      `${mark}${key.padEnd(41)} ${String(s.ok).padStart(5)} ${String(s.fail).padStart(5)} ${String(s.json).padStart(5)} ${String(total).padStart(6)}`
    );
  }

  console.log('-'.repeat(68));
  console.log(
    `TOTAL`.padEnd(42),
    String(totalOk).padStart(5),
    String(totalFail).padStart(5),
    String(totalJson).padStart(5),
    String(totalOk + totalFail + totalJson).padStart(6)
  );
  console.log(
    `\nLog files: ${report.files.length}, aiserver entries: ${report.totalEntries}, empty body: ${report.skippedNoBody}, non-aiserver skipped: ${report.skippedNonAiserver}`
  );

  const failures = rows.filter(([, s]) => s.fail > 0);
  if (failures.length > 0) {
    console.log('\n## Failures / notes (sample)\n');
    for (const [key, s] of failures.slice(0, 25)) {
      console.log(`### ${key}`);
      for (const sample of s.samples) {
        console.log(`  - ${sample}`);
      }
    }
  }

  const successRate =
    totalOk + totalFail > 0
      ? ((100 * totalOk) / (totalOk + totalFail)).toFixed(1)
      : 'n/a';
  console.log(
    `\nDecode/validation rate (excl. JSON-only counted separately): ${successRate}% OK among proto+JSON validated (${totalOk} ok, ${totalFail} fail). JSON Connect entries: ${totalJson}.`
  );

  const usageMethods = [
    'GetCurrentPeriodUsage',
    'GetUsageLimitStatusAndActiveGrants',
    'GetPlanInfo',
    'GetTokenUsage',
    'GetTeams',
    'GetMe',
  ];
  console.log('\n## Billing / dashboard RPCs (any direction)\n');
  for (const m of usageMethods) {
    const d = report.dashboard.get(m);
    if (!d) continue;
    const t = d.ok + d.fail;
    if (t === 0) continue;
    const pct = ((100 * d.ok) / t).toFixed(0);
    console.log(`  ${m}: ${d.ok}/${t} OK (${pct}%)`);
  }

  const usageFails = usageMethods.filter((m) => {
    const d = report.dashboard.get(m);
    return d && d.fail > 0;
  });
  process.exit(usageFails.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
