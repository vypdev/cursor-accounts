/**
 * Aggregate billing, token, context, and nested Agent insights for one entry.
 */

import {
  extractAgentInsight,
  extractBillingInsight,
  extractContextInsight,
  extractTokenInsight,
} from './proxy-insights.mjs';
import { extractAgentInnerInsight } from './bidi-agent-decode.mjs';

/**
 * @typedef {{ billing: unknown, tokens: unknown, context: unknown, agent: unknown, agentTokenEvent: boolean }} EntryInsights
 */

/**
 * @param {Record<string, any>} obj
 * @param {string} rpcPath
 * @param {'request' | 'response'} direction
 * @param {(obj: Record<string, any>, rpcPath: string, direction: 'request' | 'response') => Promise<Record<string, any> | null>} decodeInner
 * @returns {Promise<EntryInsights>}
 */
export async function collectEntryInsights(obj, rpcPath, direction, decodeInner) {
  const base = createBaseInsights(obj);
  const inner = await decodeInner(obj, rpcPath, direction);
  const innerAgent = inner ? extractAgentInnerInsight(inner) : null;
  return innerAgent ? mergeInnerAgentInsight(base, innerAgent) : base;
}

/**
 * @param {EntryInsights} insights
 */
export function hasEntryInsights(insights) {
  return Boolean(
    insights.billing || insights.tokens || insights.context || insights.agent
  );
}

/**
 * @param {Record<string, any>} obj
 * @returns {EntryInsights}
 */
function createBaseInsights(obj) {
  return {
    billing: extractBillingInsight(obj),
    tokens: extractTokenInsight(obj),
    context: extractContextInsight(obj),
    agent: extractAgentInsight(obj),
    agentTokenEvent: false,
  };
}

/**
 * @param {EntryInsights} base
 * @param {Record<string, any>} innerAgent
 * @returns {EntryInsights}
 */
function mergeInnerAgentInsight(base, innerAgent) {
  return {
    billing: base.billing,
    context: base.context,
    agent: base.agent ? { ...base.agent, ...innerAgent } : innerAgent,
    tokens: tokenInsightForInnerAgent(base.tokens, innerAgent),
    agentTokenEvent:
      innerAgent.streamingTokens != null || innerAgent.inputTokens != null,
  };
}

/**
 * @param {unknown} current
 * @param {Record<string, any>} innerAgent
 */
function tokenInsightForInnerAgent(current, innerAgent) {
  if (innerAgent.inputTokens != null || innerAgent.outputTokens != null) {
    return {
      inputTokens: innerAgent.inputTokens,
      outputTokens: innerAgent.outputTokens,
      cacheReadTokens: innerAgent.cacheReadTokens,
      cacheWriteTokens: innerAgent.cacheWriteTokens,
    };
  }
  if (innerAgent.streamingTokens != null) {
    return { totalTokens: innerAgent.streamingTokens };
  }
  return current;
}
