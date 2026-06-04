/**
 * Extract tokenizable text from decoded Agent bidi / RunSSE protobuf objects.
 */

import zlib from 'node:zlib';
import { connectPayloadCandidates } from './connect-payload.mjs';

const MAX_CONNECT_FRAME_BYTES = 5_000_000;

const OUTPUT_PATH_RE =
  /(?:^|\.)((?:textDelta|text_delta|thinkingDelta|thinking_delta|assistantMessage|assistant_message|thinkingMessage|thinking_message|partialToolCall|partial_tool_call|toolCallDelta|tool_call_delta|summary|communicateUpdateFinalSummary|communicate_update_final_summary))(?:\.|$)/i;

const INPUT_PATH_RE =
  /(?:^|\.)((?:userMessage|user_message|runRequest|run_request|execClientMessage|exec_client_message|toolResult|tool_result|shellResult|shell_result|selectedContext|selected_context|conversationState|conversation_state|finalMessage|final_message|arguments|command|stdout|stderr|richText|rich_text|customSystemPrompt|custom_system_prompt|preFetched|pre_fetched|fileStates|file_states|rootPromptMessagesJson|root_prompt_messages_json|prompt|content|description|output|message|instructions|plan|overview|query|code|diff|patch))(?:\.|$)/i;

const SKIP_PATH_RE =
  /(?:requestId|request_id|conversationId|conversation_id|messageId|message_id|toolCallId|tool_call_id|uuid|url|path|fullPath|full_path|modelName|model_name|timestamp|transcriptPath|transcript_path|plugin|marketplace|gitRemoteOrigin|git_remote_origin)$/i;

/**
 * @param {Buffer} body
 * @param {number} offset
 */
export function tryConnectFrame(body, offset) {
  if (offset + 5 > body.length) {
    return null;
  }
  const length = body.readUInt32BE(offset + 1);
  if (length <= 0 || length > MAX_CONNECT_FRAME_BYTES) {
    return null;
  }
  if (offset + 5 + length > body.length) {
    return null;
  }
  return {
    payload: body.subarray(offset + 5, offset + 5 + length),
    nextOffset: offset + 5 + length,
  };
}

/**
 * @param {import('protobufjs').Type} Type
 * @param {Buffer} payload
 */
export function decodeAgentServerPayload(Type, payload) {
  /** @type {Buffer[]} */
  const candidates = [payload];
  try {
    candidates.push(zlib.gunzipSync(payload));
  } catch {
    // not gzip
  }
  for (const candidate of candidates) {
    for (const framed of connectPayloadCandidates(candidate)) {
      try {
        const msg = Type.decode(framed);
        return Type.toObject(msg, {
          longs: String,
          enums: String,
          bytes: String,
          defaults: false,
          arrays: true,
          objects: true,
          oneofs: true,
        });
      } catch {
        // try next candidate
      }
    }
  }
  return null;
}

/**
 * Scan RunSSE / StreamBidi AgentServerMessage stream (gzip-aware per frame).
 * @param {import('protobufjs').Type} Type
 * @param {Buffer} body
 */
export function scanAgentServerStream(Type, body) {
  /** @type {Record<string, unknown>[]} */
  const messages = [];
  let offset = 0;
  while (offset < body.length) {
    const frame = tryConnectFrame(body, offset);
    if (!frame) {
      offset += 1;
      continue;
    }
    offset = frame.nextOffset;
    const decoded = decodeAgentServerPayload(Type, frame.payload);
    if (decoded) {
      messages.push(decoded);
    }
  }
  return messages;
}

/**
 * @param {import('protobufjs').Type} Type
 * @param {Buffer} body
 */
export function scanConnectFrames(Type, body) {
  /** @type {Record<string, unknown>[]} */
  const messages = [];
  let offset = 0;
  while (offset < body.length) {
    const frame = tryConnectFrame(body, offset);
    if (!frame) {
      if (isIncompleteFrameAt(body, offset)) {
        break;
      }
      offset += 1;
      continue;
    }
    offset = frame.nextOffset;
    try {
      const msg = Type.decode(frame.payload);
      messages.push(
        Type.toObject(msg, {
          longs: String,
          enums: String,
          bytes: String,
          defaults: false,
          arrays: true,
          objects: true,
          oneofs: true,
        })
      );
    } catch {
      // try gzip / nested candidates handled by caller if needed
    }
  }
  return messages;
}

/**
 * @param {Buffer} body
 * @param {number} offset
 */
function isIncompleteFrameAt(body, offset) {
  if (offset + 5 > body.length) {
    return true;
  }
  const length = body.readUInt32BE(offset + 1);
  return (
    length > 0 &&
    length <= MAX_CONNECT_FRAME_BYTES &&
    offset + 5 + length > body.length
  );
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {{ inputChars: number, outputChars: number, inputSnippets: string[], outputSnippets: string[], miscChars: number, checkpointUsedTokens: number[] }} acc
 */
function walkValue(value, path, acc) {
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
      const n = Number(text);
      if (Number.isFinite(n)) {
        acc.checkpointUsedTokens.push(n);
      }
      return;
    }

    const words = text.split(/\s+/).filter(Boolean).length;
    const chars = text.length;

    if (OUTPUT_PATH_RE.test(path)) {
      acc.outputChars += chars;
      if (acc.outputSnippets.length < 5) {
        acc.outputSnippets.push(truncate(text, 120));
      }
      return;
    }

    if (INPUT_PATH_RE.test(path)) {
      acc.inputChars += chars;
      if (acc.inputSnippets.length < 5) {
        acc.inputSnippets.push(truncate(text, 120));
      }
      return;
    }

    acc.miscChars += chars;
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      walkValue(value[i], `${path}[${i}]`, acc);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      walkValue(nested, path ? `${path}.${key}` : key, acc);
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

function truncate(text, max) {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max - 1)}…`;
}

/**
 * @param {Record<string, unknown>} message
 */
export function extractTextBucketsFromMessage(message) {
  const acc = {
    inputChars: 0,
    outputChars: 0,
    miscChars: 0,
    inputSnippets: [],
    outputSnippets: [],
    checkpointUsedTokens: [],
  };
  walkValue(message, '', acc);
  return acc;
}

/**
 * @param {Record<string, unknown>[]} messages
 */
export function mergeTextBuckets(messages) {
  const merged = {
    inputChars: 0,
    outputChars: 0,
    miscChars: 0,
    inputSnippets: [],
    outputSnippets: [],
    checkpointUsedTokens: [],
    frameCount: messages.length,
  };
  for (const message of messages) {
    const bucket = extractTextBucketsFromMessage(message);
    merged.inputChars += bucket.inputChars;
    merged.outputChars += bucket.outputChars;
    merged.miscChars += bucket.miscChars;
    merged.checkpointUsedTokens.push(...bucket.checkpointUsedTokens);
    merged.inputSnippets.push(...bucket.inputSnippets);
    merged.outputSnippets.push(...bucket.outputSnippets);
  }
  merged.inputSnippets = merged.inputSnippets.slice(0, 8);
  merged.outputSnippets = merged.outputSnippets.slice(0, 8);
  return merged;
}

const MAX_SANE_TURN_TOKENS = 50_000_000;

/**
 * @param {unknown} value
 */
function saneTokenCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_SANE_TURN_TOKENS) {
    return 0;
  }
  return Math.trunc(n);
}

/**
 * Sum streaming delta text only (textDelta / thinkingDelta), not full snapshots.
 * @param {Record<string, unknown>[]} messages
 */
export function sumStreamDeltaText(messages) {
  let textDeltaChars = 0;
  let thinkingDeltaChars = 0;
  let tokenDeltaEvents = 0;
  let tokenDeltaPeak = 0;
  let turnEndedEvents = 0;
  let turnEndedInput = 0;
  let turnEndedOutput = 0;

  for (const message of messages) {
    const upd = message.interactionUpdate ?? message.interaction_update;
    if (!upd || typeof upd !== 'object') {
      continue;
    }
    const td = upd.textDelta ?? upd.text_delta;
    if (td && typeof td === 'object' && td.text != null) {
      textDeltaChars += String(td.text).length;
    }
    const th = upd.thinkingDelta ?? upd.thinking_delta;
    if (th && typeof th === 'object' && th.text != null) {
      thinkingDeltaChars += String(th.text).length;
    }
    const tok = upd.tokenDelta ?? upd.token_delta;
    if (tok && Number.isFinite(Number(tok.tokens))) {
      tokenDeltaEvents += 1;
      tokenDeltaPeak = Math.max(tokenDeltaPeak, Number(tok.tokens));
    }
    const te = upd.turnEnded ?? upd.turn_ended;
    if (te && typeof te === 'object') {
      const inTok = saneTokenCount(te.inputTokens ?? te.input_tokens);
      const outTok = saneTokenCount(te.outputTokens ?? te.output_tokens);
      if (inTok > 0 || outTok > 0) {
        turnEndedEvents += 1;
        turnEndedInput += inTok;
        turnEndedOutput += outTok;
      }
    }
  }

  return {
    textDeltaChars,
    thinkingDeltaChars,
    tokenDeltaEvents,
    tokenDeltaPeak,
    turnEndedEvents,
    turnEndedInput,
    turnEndedOutput,
  };
}

/**
 * Dedupe preFetched blob values across BidiAppend client messages (proxy for cache/context).
 * @param {Record<string, unknown>[]} clientMessages
 */
export function sumUniquePrefetchedBlobChars(clientMessages) {
  const seen = new Set();
  let chars = 0;
  for (const message of clientMessages) {
    const rr = message.runRequest ?? message.run_request;
    const blobs = rr?.preFetchedBlobs ?? rr?.pre_fetched_blobs ?? [];
    if (!Array.isArray(blobs)) {
      continue;
    }
    for (const blob of blobs) {
      const value = blob?.value;
      if (typeof value !== 'string' || value.length < 8 || seen.has(value)) {
        continue;
      }
      seen.add(value);
      chars += value.length;
    }
  }
  return chars;
}

/**
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
