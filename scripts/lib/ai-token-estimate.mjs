/**
 * Token estimation via ai-tokenizer (pure JS, no WASM).
 * @see https://github.com/coder/ai-tokenizer
 */

import { Tokenizer } from 'ai-tokenizer';
import * as o200k_base from 'ai-tokenizer/encoding/o200k_base';
import * as cl100k_base from 'ai-tokenizer/encoding/cl100k_base';
import * as claude from 'ai-tokenizer/encoding/claude';

/** @type {Map<string, Tokenizer>} */
const tokenizerCache = new Map();

/** @type {Record<string, import('ai-tokenizer').Encoding>} */
const ENCODINGS = {
  o200k_base,
  cl100k_base,
  claude,
};

/**
 * @param {'o200k_base' | 'cl100k_base' | 'claude'} encodingName
 */
function getTokenizer(encodingName) {
  let tokenizer = tokenizerCache.get(encodingName);
  if (!tokenizer) {
    const data = ENCODINGS[encodingName];
    if (!data) {
      throw new Error(`Unknown encoding: ${encodingName}`);
    }
    tokenizer = new Tokenizer(data);
    tokenizerCache.set(encodingName, tokenizer);
  }
  return tokenizer;
}

/**
 * Map Cursor / dashboard model ids to ai-tokenizer encodings.
 * @param {string | undefined | null} modelName
 * @returns {'o200k_base' | 'cl100k_base' | 'claude'}
 */
export function encodingForCursorModel(modelName) {
  const m = String(modelName ?? '').toLowerCase();

  if (
    m.includes('claude') ||
    m.includes('composer') ||
    m.includes('sonnet') ||
    m.includes('opus') ||
    m.includes('haiku')
  ) {
    return 'claude';
  }

  if (m.includes('gpt-3.5') || m.includes('gpt-4') && !m.includes('gpt-4o')) {
    return 'cl100k_base';
  }

  // default, gpt-4o, o-series, most Cursor "default" paths
  return 'o200k_base';
}

/**
 * @param {string} text
 * @param {'o200k_base' | 'cl100k_base' | 'claude'} [encodingName]
 */
export function countTextTokens(text, encodingName = 'o200k_base') {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  const tokenizer = getTokenizer(encodingName);
  // Proxy traffic may contain literal special-token strings (e.g. <|endoftext|>).
  return tokenizer.encode(text, 'all').length;
}

/**
 * @param {string} text
 * @param {string | undefined | null} modelName
 */
export function countTextTokensForModel(text, modelName) {
  return countTextTokens(text, encodingForCursorModel(modelName));
}

/**
 * @param {string[]} texts
 * @param {string | undefined | null} modelName
 */
export function countTextsTokensForModel(texts, modelName) {
  const encoding = encodingForCursorModel(modelName);
  const tokenizer = getTokenizer(encoding);
  let total = 0;
  for (const text of texts) {
    if (typeof text === 'string' && text.length > 0) {
      total += tokenizer.encode(text, 'all').length;
    }
  }
  return total;
}

/**
 * Legacy char heuristics (for comparison only).
 * @param {number} chars
 */
export function estimateTokensFromChars(chars) {
  const words = Math.max(1, Math.round(chars / 5));
  return {
    charsDiv4: Math.ceil(chars / 4),
    charsDiv3_5: Math.ceil(chars / 3.5),
    wordsX1_3: Math.ceil(words * 1.3),
  };
}

/**
 * Walk protobuf object and sum ai-tokenizer counts on extracted strings.
 * Uses same path rules as agent-text-extract (input/output/misc buckets).
 * @param {Record<string, unknown>} message
 * @param {'o200k_base' | 'cl100k_base' | 'claude'} encodingName
 */
export function tokenizeTextBucketsFromMessage(message, encodingName = 'o200k_base') {
  const tokenizer = getTokenizer(encodingName);
  const acc = {
    inputTokens: 0,
    outputTokens: 0,
    miscTokens: 0,
    stringsSeen: 0,
  };

  walkAndTokenize(message, '', tokenizer, acc);
  return acc;
}

const OUTPUT_PATH_RE =
  /(?:^|\.)((?:textDelta|text_delta|thinkingDelta|thinking_delta|assistantMessage|assistant_message|thinkingMessage|thinking_message|partialToolCall|partial_tool_call|toolCallDelta|tool_call_delta|summary|communicateUpdateFinalSummary|communicate_update_final_summary))(?:\.|$)/i;

const INPUT_PATH_RE =
  /(?:^|\.)((?:userMessage|user_message|runRequest|run_request|execClientMessage|exec_client_message|toolResult|tool_result|shellResult|shell_result|selectedContext|selected_context|conversationState|conversation_state|finalMessage|final_message|arguments|command|stdout|stderr|richText|rich_text|customSystemPrompt|custom_system_prompt|preFetched|pre_fetched|fileStates|file_states|rootPromptMessagesJson|root_prompt_messages_json|prompt|content|description|output|message|instructions|plan|overview|query|code|diff|patch))(?:\.|$)/i;

const SKIP_PATH_RE =
  /(?:requestId|request_id|conversationId|conversation_id|messageId|message_id|toolCallId|tool_call_id|uuid|url|path|fullPath|full_path|modelName|model_name|timestamp|transcriptPath|transcript_path|plugin|marketplace|gitRemoteOrigin|git_remote_origin)$/i;

/**
 * @param {unknown} value
 * @param {string} path
 * @param {Tokenizer} tokenizer
 * @param {{ inputTokens: number, outputTokens: number, miscTokens: number, stringsSeen: number }} acc
 */
function walkAndTokenize(value, path, tokenizer, acc) {
  if (value == null) {
    return;
  }

  if (typeof value === 'string') {
    if (value.length < 8 || SKIP_PATH_RE.test(path)) {
      return;
    }
    if (/^[0-9a-f]{32,}$/i.test(value)) {
      return;
    }

    const printable = tryDecodeBytesString(value);
    const text = printable.length >= 8 ? printable : value;
    if (text.length < 8) {
      return;
    }

    if (path.endsWith('usedTokens') || path.endsWith('used_tokens')) {
      return;
    }

    const tokens = tokenizer.encode(text, 'all').length;
    acc.stringsSeen += 1;

    if (OUTPUT_PATH_RE.test(path)) {
      acc.outputTokens += tokens;
      return;
    }
    if (INPUT_PATH_RE.test(path)) {
      acc.inputTokens += tokens;
      return;
    }
    acc.miscTokens += tokens;
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      walkAndTokenize(value[i], `${path}[${i}]`, tokenizer, acc);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      walkAndTokenize(nested, path ? `${path}.${key}` : key, tokenizer, acc);
    }
  }
}

function tryDecodeBytesString(value) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0 || value.length < 16) {
    return value;
  }
  try {
    const buf = Buffer.from(value, 'hex');
    const asUtf8 = buf.toString('utf8');
    if (asUtf8.includes('\uFFFD') || !/[\x20-\x7E\n\r\t]/.test(asUtf8)) {
      return value;
    }
    return asUtf8;
  } catch {
    return value;
  }
}
