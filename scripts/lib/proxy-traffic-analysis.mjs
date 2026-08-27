/**
 * Application-level analysis for protobuf JSONL proxy captures.
 *
 * This module owns capture classification and insight aggregation. The CLI
 * remains responsible only for loading the schema, resolving its input, and
 * rendering the report.
 */

import fs from 'node:fs';
import path from 'node:path';
import { decodeBidiAgentInner } from './bidi-agent-decode.mjs';
import {
  isInteractiveRpcPath,
  parseConnectRpcPath,
  resolveRpcMessageType,
} from './proxy-rpc.mjs';
import { decodeProxyEntry } from './proxy-entry-decoder.mjs';
import {
  collectEntryInsights,
  hasEntryInsights,
} from './proxy-entry-insights.mjs';

export const MAX_INSIGHT_SAMPLES = 20;

/** @typedef {{ total: number, decoded: number, insights: number, agentTokenEvents: number, interactiveDecoded: number, byMethod: Map<string, number>, insightSamples: Array<{ key: string, file: string, billing: unknown, tokens: unknown, context: unknown, agent: unknown }> }} TrafficAnalysisReport */

/** @returns {TrafficAnalysisReport} */
export function createTrafficAnalysisReport() {
  return {
    total: 0,
    decoded: 0,
    insights: 0,
    agentTokenEvents: 0,
    interactiveDecoded: 0,
    byMethod: new Map(),
    insightSamples: [],
  };
}

/**
 * @param {string} target
 * @returns {{ files: string[], logDir: string }}
 */
export function resolveProxyLogFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return { files: [target], logDir: path.dirname(target) };
  }

  const files = fs
    .readdirSync(target)
    .filter((file) => file.endsWith('.jsonl'))
    .sort()
    .map((file) => path.join(target, file));
  return { files, logDir: target };
}

export { decodeProxyEntry } from './proxy-entry-decoder.mjs';

/**
 * Analyze one decoded capture entry.
 *
 * @param {Record<string, any>} entry
 * @param {{ file: string, logDir: string, rpcMap: Map<string, { requestType: import('protobufjs').Type, responseType: import('protobufjs').Type }>, report: TrafficAnalysisReport, decodeInner?: typeof decodeBidiAgentInner }} options
 * @returns {Promise<void>}
 */
export async function analyzeProxyEntry(entry, options) {
  const decoded = resolveAnalyzableEntry(entry, options);
  if (!decoded) {
    return;
  }

  recordDecodedEntry(options.report, decoded.rpcPath, decoded.key);

  const insights = await collectEntryInsights(
    decoded.object,
    decoded.rpcPath,
    decoded.direction,
    options.decodeInner ?? decodeBidiAgentInner
  );
  if (insights.agentTokenEvent) {
    options.report.agentTokenEvents += 1;
  }
  if (!hasEntryInsights(insights)) {
    return;
  }

  recordEntryInsights(options.report, options.file, decoded.key, insights);
}

function resolveAnalyzableEntry(entry, options) {
  if (entry.direction !== 'request' && entry.direction !== 'response') {
    return null;
  }
  const rpcPath = parseConnectRpcPath(String(entry.url ?? ''));
  if (!rpcPath) {
    return null;
  }

  options.report.total += 1;
  const Type = resolveRpcMessageType(rpcPath, entry.direction, options.rpcMap);
  if (!Type) {
    return null;
  }
  const object = decodeProxyEntry(entry, Type, options.logDir);
  if (!object) {
    return null;
  }
  const key = `${rpcPath.replace(/^\//, '')}:${entry.direction}`;
  return { object, rpcPath, direction: entry.direction, key };
}

function recordDecodedEntry(report, rpcPath, key) {
  report.decoded += 1;
  report.byMethod.set(key, (report.byMethod.get(key) ?? 0) + 1);
  if (isInteractiveRpcPath(rpcPath)) {
    report.interactiveDecoded += 1;
  }
}

function recordEntryInsights(report, file, key, insights) {
  report.insights += 1;
  if (report.insightSamples.length >= MAX_INSIGHT_SAMPLES) {
    return;
  }
  report.insightSamples.push({
    key,
    file: path.basename(file),
    billing: insights.billing,
    tokens: insights.tokens,
    context: insights.context,
    agent: insights.agent,
  });
}

/**
 * Analyze all supplied JSONL files.
 *
 * @param {string[]} files
 * @param {string} logDir
 * @param {Map<string, { requestType: import('protobufjs').Type, responseType: import('protobufjs').Type }>} rpcMap
 * @param {{ readFile?: typeof fs.readFileSync, decodeInner?: typeof decodeBidiAgentInner }} [options]
 * @returns {Promise<TrafficAnalysisReport>}
 */
export async function analyzeProxyFiles(files, logDir, rpcMap, options = {}) {
  const report = createTrafficAnalysisReport();
  const readFile = options.readFile ?? fs.readFileSync;
  for (const file of files) {
    await analyzeProxyFile(file, {
      logDir,
      rpcMap,
      report,
      readFile,
      decodeInner: options.decodeInner,
    });
  }
  return report;
}

async function analyzeProxyFile(file, options) {
  const content = options.readFile(file, 'utf8');
  for (const line of content.split('\n')) {
    const entry = parseCaptureLine(line);
    if (!entry) {
      continue;
    }
    await analyzeProxyEntry(entry, { ...options, file });
  }
}

function parseCaptureLine(line) {
  if (!line.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
