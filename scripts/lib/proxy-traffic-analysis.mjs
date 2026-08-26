/**
 * Application-level analysis for protobuf JSONL proxy captures.
 *
 * This module owns capture classification and insight aggregation. The CLI
 * remains responsible only for loading the schema, resolving its input, and
 * rendering the report.
 */

import fs from 'node:fs';
import path from 'node:path';
import { bodyBufferFromEntry } from './proxy-log-body.mjs';
import {
  extractAgentInsight,
  extractBillingInsight,
  extractContextInsight,
  extractTokenInsight,
} from './proxy-insights.mjs';
import {
  decodeBidiAgentInner,
  extractAgentInnerInsight,
} from './bidi-agent-decode.mjs';
import {
  isInteractiveRpcPath,
  parseConnectRpcPath,
  resolveRpcMessageType,
} from './proxy-rpc.mjs';
import { tryDecodeProto } from './proto-jsonl-verifier.mjs';

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

/**
 * Decode one capture entry using either its JSON representation or the
 * protobuf type resolved for its Connect RPC path.
 *
 * @param {Record<string, any>} entry
 * @param {import('protobufjs').Type} Type
 * @param {string} logDir
 * @returns {Record<string, any> | null}
 */
export function decodeProxyEntry(entry, Type, logDir) {
  const contentType = String(entry.headers?.['content-type'] ?? '').toLowerCase();
  if (contentType.includes('json')) {
    const body =
      entry.body ?? bodyBufferFromEntry(entry, logDir)?.toString('utf8');
    if (!body) {
      return null;
    }
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  const raw = bodyBufferFromEntry(entry, logDir);
  if (!raw?.length) {
    return null;
  }
  const contentEncoding = String(
    entry.headers?.['content-encoding'] ?? ''
  ).toLowerCase();
  const result = tryDecodeProto(
    Type,
    raw,
    entry.bodyDecompressed ? '' : contentEncoding
  );
  return result.ok ? result.object : null;
}

/**
 * @param {Record<string, any>} obj
 * @param {string} rpcPath
 * @param {'request' | 'response'} direction
 * @param {(obj: Record<string, any>, rpcPath: string, direction: 'request' | 'response') => Promise<Record<string, any> | null>} decodeInner
 */
async function collectEntryInsights(obj, rpcPath, direction, decodeInner) {
  const billing = extractBillingInsight(obj);
  let tokens = extractTokenInsight(obj);
  const context = extractContextInsight(obj);
  let agent = extractAgentInsight(obj);
  let agentTokenEvent = false;

  const inner = await decodeInner(obj, rpcPath, direction);
  const innerAgent = inner ? extractAgentInnerInsight(inner) : null;
  if (innerAgent) {
    agent = agent ? { ...agent, ...innerAgent } : innerAgent;
    agentTokenEvent =
      innerAgent.streamingTokens != null || innerAgent.inputTokens != null;
    if (innerAgent.inputTokens != null || innerAgent.outputTokens != null) {
      tokens = {
        inputTokens: innerAgent.inputTokens,
        outputTokens: innerAgent.outputTokens,
        cacheReadTokens: innerAgent.cacheReadTokens,
        cacheWriteTokens: innerAgent.cacheWriteTokens,
      };
    } else if (innerAgent.streamingTokens != null) {
      tokens = { totalTokens: innerAgent.streamingTokens };
    }
  }

  return { billing, tokens, context, agent, agentTokenEvent };
}

/**
 * Analyze one decoded capture entry.
 *
 * @param {Record<string, any>} entry
 * @param {{ file: string, logDir: string, rpcMap: Map<string, { requestType: import('protobufjs').Type, responseType: import('protobufjs').Type }>, report: TrafficAnalysisReport, decodeInner?: typeof decodeBidiAgentInner }} options
 * @returns {Promise<void>}
 */
export async function analyzeProxyEntry(entry, options) {
  if (entry.direction !== 'request' && entry.direction !== 'response') {
    return;
  }

  const rpcPath = parseConnectRpcPath(String(entry.url ?? ''));
  if (!rpcPath) {
    return;
  }

  const { file, logDir, rpcMap, report } = options;
  report.total += 1;
  const Type = resolveRpcMessageType(rpcPath, entry.direction, rpcMap);
  if (!Type) {
    return;
  }

  const obj = decodeProxyEntry(entry, Type, logDir);
  if (!obj) {
    return;
  }

  report.decoded += 1;
  const methodKey = rpcPath.replace(/^\//, '');
  const key = `${methodKey}:${entry.direction}`;
  report.byMethod.set(key, (report.byMethod.get(key) ?? 0) + 1);
  if (isInteractiveRpcPath(rpcPath)) {
    report.interactiveDecoded += 1;
  }

  const insights = await collectEntryInsights(
    obj,
    rpcPath,
    entry.direction,
    options.decodeInner ?? decodeBidiAgentInner
  );
  if (insights.agentTokenEvent) {
    report.agentTokenEvents += 1;
  }
  if (!insights.billing && !insights.tokens && !insights.context && !insights.agent) {
    return;
  }

  report.insights += 1;
  if (report.insightSamples.length < MAX_INSIGHT_SAMPLES) {
    report.insightSamples.push({
      key,
      file: path.basename(file),
      billing: insights.billing,
      tokens: insights.tokens,
      context: insights.context,
      agent: insights.agent,
    });
  }
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
    const content = readFile(file, 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      await analyzeProxyEntry(entry, {
        file,
        logDir,
        rpcMap,
        report,
        decodeInner: options.decodeInner,
      });
    }
  }
  return report;
}
