/**
 * Verification primitives for protobuf JSONL proxy captures.
 *
 * The module deliberately has no CLI side effects so the capture contract can
 * be tested without loading the local Cursor installation or writing output.
 */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { bodyBufferFromEntry } from './proxy-log-body.mjs';
import { connectPayloadCandidates } from './connect-payload.mjs';
export { connectPayloadCandidates } from './connect-payload.mjs';
import {
  extractAgentInsight,
  extractBillingInsight,
  extractContextInsight,
  extractTokenInsight,
} from './proxy-insights.mjs';
import {
  parseConnectRpcPath,
  resolveRpcMessageType,
} from './proxy-rpc.mjs';

/**
 * @param {Buffer} raw
 * @param {string} contentEncoding
 * @returns {Buffer}
 */
export function prepareBody(raw, contentEncoding) {
  if (contentEncoding.includes('gzip')) {
    try {
      return zlib.gunzipSync(raw);
    } catch {
      // Logged body may be UTF-8-mangled gzip; retain the original bytes.
    }
  }
  return raw;
}

/**
 * @param {import('protobufjs').Type} Type
 * @param {Buffer} raw
 * @param {string} contentEncoding
 */
export function tryDecodeProto(Type, raw, contentEncoding = '') {
  const prepared = prepareBody(raw, contentEncoding);
  let lastErr;
  for (const payload of connectPayloadCandidates(prepared)) {
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
 * @param {Record<string, unknown>} obj
 * @param {protobuf.Type} Type
 */
export function jsonKeysMatchProto(obj, Type) {
  const protoFields = new Set(
    Type.fieldsArray.map((field) => field.name).filter(Boolean)
  );
  const jsonKeys = Object.keys(obj).filter(
    (key) => obj[key] !== undefined && obj[key] !== null
  );
  const unknown = jsonKeys.filter((key) => !protoFields.has(key));
  const missing = [...protoFields].filter(
    (key) => !(key in obj) && !key.startsWith('_')
  );
  return {
    unknown,
    missing: missing.slice(0, 8),
    protoFieldCount: protoFields.size,
  };
}

/** @typedef {{ ok: number, fail: number, json: number, gzip: number, samples: string[] }} MethodStats */
/** @typedef {{ ok: number, fail: number }} DashboardStats */

/**
 * @typedef VerificationReport
 * @property {string[]} files
 * @property {Map<string, MethodStats>} byMethod
 * @property {Map<string, DashboardStats>} dashboard
 * @property {number} totalEntries
 * @property {number} skippedNoBody
 * @property {number} skippedNonConnect
 * @property {number} insightBilling
 * @property {number} insightTokens
 * @property {number} insightContext
 * @property {number} insightAgent
 * @property {number} base64Bodies
 */

/** @returns {VerificationReport} */
function createReport(files) {
  return {
    files,
    byMethod: new Map(),
    dashboard: new Map(),
    totalEntries: 0,
    skippedNoBody: 0,
    skippedNonConnect: 0,
    insightBilling: 0,
    insightTokens: 0,
    insightContext: 0,
    insightAgent: 0,
    base64Bodies: 0,
  };
}

/** @returns {MethodStats} */
function createMethodStats() {
  return { ok: 0, fail: 0, json: 0, gzip: 0, samples: [] };
}

/**
 * @param {Map<string, MethodStats>} byMethod
 * @param {string} key
 * @returns {MethodStats}
 */
function methodStatsFor(byMethod, key) {
  let stats = byMethod.get(key);
  if (!stats) {
    stats = createMethodStats();
    byMethod.set(key, stats);
  }
  return stats;
}

/**
 * @param {Map<string, DashboardStats>} dashboard
 * @param {string} key
 * @returns {DashboardStats}
 */
function dashboardStatsFor(dashboard, key) {
  let stats = dashboard.get(key);
  if (!stats) {
    stats = { ok: 0, fail: 0 };
    dashboard.set(key, stats);
  }
  return stats;
}

/** @param {string[]} samples @param {string} sample @param {number} limit */
function addSample(samples, sample, limit = 2) {
  if (samples.length < limit) {
    samples.push(sample);
  }
}

/**
 * @param {MethodStats} stats
 * @param {DashboardStats} dashboard
 * @param {boolean} ok
 */
function recordResult(stats, dashboard, ok) {
  if (ok) {
    stats.ok++;
    dashboard.ok++;
  } else {
    stats.fail++;
    dashboard.fail++;
  }
}

/** @param {VerificationReport} report @param {Record<string, unknown>} obj */
function recordInsights(report, obj) {
  if (extractBillingInsight(obj)) report.insightBilling++;
  if (extractTokenInsight(obj)) report.insightTokens++;
  if (extractContextInsight(obj)) report.insightContext++;
  if (extractAgentInsight(obj)) report.insightAgent++;
}

/**
 * @param {Record<string, unknown>} entry
 * @param {import('protobufjs').Type} Type
 * @param {MethodStats} stats
 * @param {DashboardStats} dashboard
 * @param {VerificationReport} report
 * @param {string} file
 * @param {Buffer | null} body
 */
function verifyJsonEntry(entry, Type, stats, dashboard, report, file, body) {
  stats.json++;
  try {
    const json = JSON.parse(entry.body ?? body?.toString('utf8') ?? '{}');
    const { unknown } = jsonKeysMatchProto(json, Type);
    recordInsights(report, json);
    if (unknown.length === 0) {
      recordResult(stats, dashboard, true);
      return;
    }
    recordResult(stats, dashboard, false);
    addSample(
      stats.samples,
      `JSON keys not in proto: ${unknown.slice(0, 5).join(', ')} (${file})`
    );
  } catch {
    recordResult(stats, dashboard, false);
    addSample(stats.samples, `JSON parse error (${file})`);
  }
}

/**
 * @param {Record<string, unknown>} entry
 * @param {import('protobufjs').Type} Type
 * @param {MethodStats} stats
 * @param {DashboardStats} dashboard
 * @param {VerificationReport} report
 * @param {string} file
 * @param {Buffer} body
 * @param {string} contentEncoding
 */
function verifyProtoEntry(
  entry,
  Type,
  stats,
  dashboard,
  report,
  file,
  body,
  contentEncoding
) {
  if (contentEncoding.includes('gzip')) {
    stats.gzip++;
  }
  if (entry.bodyTruncated) {
    recordResult(stats, dashboard, false);
    addSample(
      stats.samples,
      `body truncated at ${entry.bodyRawBytes ?? '?'}b — recapture with proxy (${file})`
    );
    return;
  }

  const raw = body ?? Buffer.from(String(entry.body ?? ''), 'latin1');
  const result = tryDecodeProto(
    Type,
    raw,
    entry.bodyDecompressed ? '' : contentEncoding
  );
  if (result.ok) {
    recordResult(stats, dashboard, true);
    recordInsights(report, result.object);
    if (stats.samples.length < 1) {
      const keys = Object.keys(result.object).slice(0, 6).join(', ');
      const encodingNote = entry.bodyDecompressed
        ? ' decompressed'
        : contentEncoding
          ? ' gzip'
          : '';
      addSample(
        stats.samples,
        `proto decode OK ${result.payloadLen}b fields: ${keys}${encodingNote} (${file})`,
        1
      );
    }
    return;
  }

  recordResult(stats, dashboard, false);
  const hint = contentEncoding.includes('gzip')
    ? ' [gzip body may be UTF-8 corrupted in JSONL]'
    : '';
  addSample(stats.samples, `${result.error} (${raw.length}b, ${file})${hint}`);
}

/**
 * @param {Record<string, unknown>} entry
 * @param {string} file
 * @param {string} logDir
 * @param {Map<string, { requestType: import('protobufjs').Type, responseType: import('protobufjs').Type }>} rpcMap
 * @param {VerificationReport} report
 */
function verifyEntry(entry, file, logDir, rpcMap, report) {
  if (entry.direction !== 'request' && entry.direction !== 'response') {
    return;
  }
  const rpcPath = parseConnectRpcPath(String(entry.url ?? ''));
  if (!rpcPath) {
    report.skippedNonConnect++;
    return;
  }

  report.totalEntries++;
  const rpcMethod = rpcPath.split('/').pop() ?? rpcPath;
  const key = `${rpcMethod}:${entry.direction}`;
  const stats = methodStatsFor(report.byMethod, key);
  const dashboard = dashboardStatsFor(report.dashboard, rpcMethod);
  const Type = resolveRpcMessageType(rpcPath, entry.direction, rpcMap);
  if (!Type) {
    recordResult(stats, dashboard, false);
    addSample(stats.samples, `no proto types for ${rpcPath} (${file})`);
    return;
  }

  if (entry.bodyBase64) report.base64Bodies++;
  const body = bodyBufferFromEntry(entry, logDir);
  if ((!body || body.length === 0) && !entry.body) {
    report.skippedNoBody++;
    recordResult(stats, dashboard, true);
    return;
  }

  const contentType = String(entry.headers?.['content-type'] ?? '').toLowerCase();
  const contentEncoding = String(
    entry.headers?.['content-encoding'] ?? ''
  ).toLowerCase();
  if (contentType.includes('json')) {
    verifyJsonEntry(entry, Type, stats, dashboard, report, file, body);
    return;
  }
  if (!contentType.includes('proto')) {
    recordResult(stats, dashboard, false);
    addSample(
      stats.samples,
      `unexpected content-type: ${contentType || '(none)'} (${file})`
    );
    return;
  }

  verifyProtoEntry(
    entry,
    Type,
    stats,
    dashboard,
    report,
    file,
    body,
    contentEncoding
  );
}

/** @param {string} logDir @returns {string[]} */
function listLogFiles(logDir) {
  return fs
    .readdirSync(logDir)
    .filter((file) => file.endsWith('.jsonl'))
    .sort();
}

/**
 * @param {string} filePath
 * @param {string} file
 * @param {string} logDir
 * @param {Map<string, { requestType: import('protobufjs').Type, responseType: import('protobufjs').Type }>} rpcMap
 * @param {VerificationReport} report
 */
function verifyFile(filePath, file, logDir, rpcMap, report) {
  if (fs.statSync(filePath).size === 0) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    verifyEntry(entry, file, logDir, rpcMap, report);
  }
}

/**
 * Verify all JSONL captures in a directory against the extracted RPC map.
 * @param {string} logDir
 * @param {Map<string, { requestType: import('protobufjs').Type, responseType: import('protobufjs').Type }>} rpcMap
 * @returns {VerificationReport}
 */
export function verifyLogs(logDir, rpcMap) {
  const files = listLogFiles(logDir);
  const report = createReport(files);
  for (const file of files) {
    verifyFile(path.join(logDir, file), file, logDir, rpcMap, report);
  }
  return report;
}
