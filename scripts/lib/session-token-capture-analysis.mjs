/**
 * Application-level analysis for one session-token proxy capture.
 *
 * The boundary keeps JSONL traversal, protobuf decoding, RPC classification,
 * and session accounting separate from the executable CLI and its renderer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { bodyBufferFromEntry } from './proxy-log-body.mjs';
import {
  extractAgentInsight,
  extractBillingInsight,
} from './proxy-insights.mjs';
import {
  decodeBidiAgentInner,
  extractAgentInnerInsight,
} from './bidi-agent-decode.mjs';
import { scanAgentServerStream } from './agent-text-extract.mjs';
import {
  parseConnectRpcPath,
  resolveRpcMessageType,
} from './proxy-rpc.mjs';
import { decodeProxyEntry } from './proxy-traffic-analysis.mjs';
import {
  buildSessionReport,
  createSessionSummaryState,
  planSpend,
  recordAgentInsight,
  recordBillingSnapshot,
  recordRequestId,
  recordSessionTimestamp,
} from './session-token-summary.mjs';

/**
 * @param {string} line
 * @returns {Record<string, any> | null}
 */
export function parseSessionCaptureLine(line) {
  if (!line.trim()) {
    return null;
  }
  try {
    const entry = JSON.parse(line);
    return entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, any> | null} entry
 */
export function isDirectionalSessionEntry(entry) {
  return (
    entry?.direction === 'request' || entry?.direction === 'response'
  );
}

/**
 * @param {string} rpcPath
 * @param {'request' | 'response'} direction
 */
export function isAgentStreamResponse(rpcPath, direction) {
  return (
    direction === 'response' &&
    (rpcPath.includes('RunSSE') ||
      rpcPath.includes('StreamBidiSSE') ||
      (rpcPath.includes('StreamBidi') && !rpcPath.includes('StreamBidiPoll')))
  );
}

/**
 * @param {string} rpcPath
 * @param {'request' | 'response'} direction
 */
function isBillingResponse(rpcPath, direction) {
  return direction === 'response' && rpcPath.includes('GetCurrentPeriodUsage');
}

/**
 * @param {string} rpcPath
 * @param {'request' | 'response'} direction
 */
function isBidiAppendRequest(rpcPath, direction) {
  return direction === 'request' && rpcPath.includes('BidiAppend');
}

/**
 * @param {string} rpcPath
 * @param {'request' | 'response'} direction
 */
function isRunPollResponse(rpcPath, direction) {
  return direction === 'response' && rpcPath.includes('RunPoll');
}

/**
 * @param {Record<string, any>} entry
 * @param {{ summary: import('./session-token-summary.mjs').SessionSummaryState, logDir: string }} context
 */
function recordBillingEvent(entry, context) {
  const billing = extractBillingInsight(context.decoded);
  const spend = planSpend(billing?.planUsage);
  if (spend) {
    recordBillingSnapshot(context.summary, entry.timestamp, spend);
  }
}

/**
 * @param {Record<string, any>} entry
 * @param {{ summary: import('./session-token-summary.mjs').SessionSummaryState, decoded: Record<string, any> }} context
 */
function recordBidiRequestEvent(entry, context) {
  const agent = extractAgentInsight(context.decoded);
  if (agent?.requestId) {
    recordRequestId(context.summary, agent.requestId);
  }
}

/**
 * @param {Record<string, any>} entry
 * @param {string} rpcPath
 * @param {{ summary: import('./session-token-summary.mjs').SessionSummaryState, logDir: string, agentServerType: import('protobufjs').Type, scanStream: typeof scanAgentServerStream }} context
 */
function recordAgentStreamEvents(entry, rpcPath, context) {
  const raw = bodyBufferFromEntry(entry, context.logDir);
  if (!raw?.length) {
    return;
  }
  for (const message of context.scanStream(context.agentServerType, raw)) {
    recordAgentInsight(
      extractAgentInnerInsight(message),
      entry.timestamp,
      context.summary
    );
  }
}

/**
 * @param {Record<string, any>} entry
 * @param {string} rpcPath
 * @param {{ summary: import('./session-token-summary.mjs').SessionSummaryState, decodeInner: typeof decodeBidiAgentInner }} context
 */
async function recordRunPollEvent(entry, rpcPath, context) {
  const inner = await context.decodeInner(
    context.decoded,
    rpcPath,
    entry.direction
  );
  recordAgentInsight(
    inner ? extractAgentInnerInsight(inner) : null,
    entry.timestamp,
    context.summary
  );
}

/**
 * Analyze one decoded session capture entry.
 *
 * @param {Record<string, any>} entry
 * @param {{ filePath: string, logDir: string, rpcMap: Map<string, { requestType: import('protobufjs').Type, responseType: import('protobufjs').Type }>, summary: import('./session-token-summary.mjs').SessionSummaryState, agentServerType: import('protobufjs').Type, decodeInner?: typeof decodeBidiAgentInner, scanStream?: typeof scanAgentServerStream }} options
 * @returns {Promise<void>}
 */
export async function analyzeSessionCaptureEntry(entry, options) {
  if (!isDirectionalSessionEntry(entry)) {
    return;
  }

  const rpcPath = parseConnectRpcPath(String(entry.url ?? ''));
  if (!rpcPath) {
    return;
  }

  const Type = resolveRpcMessageType(rpcPath, entry.direction, options.rpcMap);
  if (!Type) {
    return;
  }

  const decoded = decodeProxyEntry(entry, Type, options.logDir);
  if (!decoded) {
    return;
  }

  const context = {
    ...options,
    decoded,
    decodeInner: options.decodeInner ?? decodeBidiAgentInner,
    scanStream: options.scanStream ?? scanAgentServerStream,
  };

  if (isAgentStreamResponse(rpcPath, entry.direction)) {
    recordAgentStreamEvents(entry, rpcPath, context);
    return;
  }
  if (isBillingResponse(rpcPath, entry.direction)) {
    recordBillingEvent(entry, context);
  }
  if (isBidiAppendRequest(rpcPath, entry.direction)) {
    recordBidiRequestEvent(entry, context);
  }
  if (isRunPollResponse(rpcPath, entry.direction)) {
    await recordRunPollEvent(entry, rpcPath, context);
  }
}

/**
 * Analyze one JSONL capture and build its session report.
 *
 * @param {string} filePath
 * @param {import('protobufjs').Root} root
 * @param {Map<string, { requestType: import('protobufjs').Type, responseType: import('protobufjs').Type }>} rpcMap
 * @param {{ readFile?: typeof fs.readFileSync, decodeInner?: typeof decodeBidiAgentInner, scanStream?: typeof scanAgentServerStream, dollarsPerM?: number }} [options]
 */
export async function analyzeSessionCaptureFile(
  filePath,
  root,
  rpcMap,
  options = {}
) {
  const summary = createSessionSummaryState();
  const readFile = options.readFile ?? fs.readFileSync;
  const logDir = path.dirname(filePath);
  const agentServerType = root.lookupType('agent.v1.AgentServerMessage');

  for (const line of readFile(filePath, 'utf8').split('\n')) {
    const entry = parseSessionCaptureLine(line);
    if (!isDirectionalSessionEntry(entry)) {
      continue;
    }
    recordSessionTimestamp(summary, entry.timestamp);
    await analyzeSessionCaptureEntry(entry, {
      filePath,
      logDir,
      rpcMap,
      summary,
      agentServerType,
      decodeInner: options.decodeInner,
      scanStream: options.scanStream,
    });
  }

  return buildSessionReport(
    path.basename(filePath),
    summary,
    options.dollarsPerM
  );
}
