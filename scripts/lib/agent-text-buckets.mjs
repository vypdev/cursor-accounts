/**
 * Extract tokenizable text from decoded Agent bidi / RunSSE protobuf objects.
 */

const OUTPUT_PATH_RE =
  /(?:^|\.)((?:textDelta|text_delta|thinkingDelta|thinking_delta|assistantMessage|assistant_message|thinkingMessage|thinking_message|partialToolCall|partial_tool_call|toolCallDelta|tool_call_delta|summary|communicateUpdateFinalSummary|communicate_update_final_summary))(?:\.|$)/i;

const INPUT_PATH_RE =
  /(?:^|\.)((?:userMessage|user_message|runRequest|run_request|execClientMessage|exec_client_message|toolResult|tool_result|shellResult|shell_result|selectedContext|selected_context|conversationState|conversation_state|finalMessage|final_message|arguments|command|stdout|stderr|richText|rich_text|customSystemPrompt|custom_system_prompt|preFetched|pre_fetched|fileStates|file_states|rootPromptMessagesJson|root_prompt_messages_json|prompt|content|description|output|message|instructions|plan|overview|query|code|diff|patch))(?:\.|$)/i;

const SKIP_PATH_RE =
  /(?:requestId|request_id|conversationId|conversation_id|messageId|message_id|toolCallId|tool_call_id|uuid|url|path|fullPath|full_path|modelName|model_name|timestamp|transcriptPath|transcript_path|plugin|marketplace|gitRemoteOrigin|git_remote_origin)$/i;

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
    collectStringValue(value, path, acc);
    return;
  }

  if (Array.isArray(value)) {
    walkArray(value, path, acc);
    return;
  }

  if (typeof value === 'object') {
    walkObject(value, path, acc);
  }
}

/**
 * @param {string} value
 * @param {string} path
 * @param {{ inputChars: number, outputChars: number, inputSnippets: string[], outputSnippets: string[], miscChars: number, checkpointUsedTokens: number[] }} acc
 */
function collectStringValue(value, path, acc) {
  if (shouldSkipString(value, path)) {
    return;
  }

  const printable = tryDecodeBytesString(value);
  const text = printable.length >= 8 ? printable : value;
  if (text.length < 8) {
    return;
  }

  if (isCheckpointPath(path)) {
    const n = Number(text);
    if (Number.isFinite(n)) {
      acc.checkpointUsedTokens.push(n);
    }
    return;
  }

  appendTextToBucket(classifyTextPath(path), text, acc);
}

function shouldSkipString(value, path) {
  return value.length < 8 || SKIP_PATH_RE.test(path) || /^[0-9a-f]{32,}$/i.test(value);
}

function isCheckpointPath(path) {
  return path.endsWith('usedTokens') || path.endsWith('used_tokens');
}

function classifyTextPath(path) {
  if (OUTPUT_PATH_RE.test(path)) {
    return 'output';
  }
  if (INPUT_PATH_RE.test(path)) {
    return 'input';
  }
  return 'misc';
}

/**
 * @param {'input' | 'output' | 'misc'} bucket
 * @param {string} text
 * @param {{ inputChars: number, outputChars: number, inputSnippets: string[], outputSnippets: string[], miscChars: number, checkpointUsedTokens: number[] }} acc
 */
function appendTextToBucket(bucket, text, acc) {
  const chars = text.length;
  if (bucket === 'output') {
    acc.outputChars += chars;
    if (acc.outputSnippets.length < 5) {
      acc.outputSnippets.push(truncate(text, 120));
    }
    return;
  }
  if (bucket === 'input') {
    acc.inputChars += chars;
    if (acc.inputSnippets.length < 5) {
      acc.inputSnippets.push(truncate(text, 120));
    }
    return;
  }
  acc.miscChars += chars;
}

/**
 * @param {unknown[]} values
 * @param {string} path
 * @param {{ inputChars: number, outputChars: number, inputSnippets: string[], outputSnippets: string[], miscChars: number, checkpointUsedTokens: number[] }} acc
 */
function walkArray(values, path, acc) {
  for (let index = 0; index < values.length; index += 1) {
    walkValue(values[index], `${path}[${index}]`, acc);
  }
}

/**
 * @param {object} value
 * @param {string} path
 * @param {{ inputChars: number, outputChars: number, inputSnippets: string[], outputSnippets: string[], miscChars: number, checkpointUsedTokens: number[] }} acc
 */
function walkObject(value, path, acc) {
  for (const [key, nested] of Object.entries(value)) {
    walkValue(nested, path ? `${path}.${key}` : key, acc);
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
