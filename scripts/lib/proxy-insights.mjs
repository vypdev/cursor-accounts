/**
 * Shared insight helpers for verify/analyze scripts (Connect JSON uses camelCase).
 */

/**
 * @param {Record<string, unknown> | null | undefined} obj
 */
export function extractBillingInsight(obj) {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  const hasSnake =
    obj.billing_cycle_start != null || obj.plan_usage != null;
  const hasCamel =
    obj.billingCycleStart != null || obj.planUsage != null;
  if (!hasSnake && !hasCamel) {
    return null;
  }
  return {
    billingCycleStart: obj.billingCycleStart ?? obj.billing_cycle_start,
    billingCycleEnd: obj.billingCycleEnd ?? obj.billing_cycle_end,
    planUsage: obj.planUsage ?? obj.plan_usage,
    spendLimit: obj.spendLimitUsage ?? obj.spend_limit_usage,
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} obj
 */
export function extractTokenInsight(obj) {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  if (obj.input_tokens != null || obj.inputTokens != null) {
    return {
      inputTokens: obj.inputTokens ?? obj.input_tokens,
      outputTokens: obj.outputTokens ?? obj.output_tokens,
    };
  }
  const usage =
    obj.metadata?.token_usage ??
    obj.metadata?.tokenUsage ??
    obj.token_usage ??
    obj.tokenUsage ??
    obj.usage;
  if (!usage) {
    return null;
  }
  return {
    modelName: obj.metadata?.model_name ?? obj.metadata?.modelName ?? obj.model_name,
    ...usage,
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} obj
 */
export function extractContextInsight(obj) {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  const messages = obj.conversation_messages ?? obj.conversationMessages;
  if (Array.isArray(messages) && messages.length > 0) {
    return { messageCount: messages.length };
  }
  return null;
}

/**
 * @param {unknown} value
 */
function pickRequestId(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'object') {
    const record = /** @type {Record<string, unknown>} */ (value);
    const nested = record.requestId ?? record.request_id;
    if (typeof nested === 'string' && nested.length > 0) {
      return nested;
    }
  }
  return null;
}

/**
 * Agent bidi session fields (RunPoll / BidiAppend / BidiPoll on api2).
 * @param {Record<string, unknown> | null | undefined} obj
 */
const DATA_PREVIEW_MAX = 240;

function previewDataField(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= DATA_PREVIEW_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, DATA_PREVIEW_MAX)}…`;
}

function dataBinaryByteLength(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    return value.length;
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return value.length;
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  if (typeof value === 'object' && value !== null && 'length' in value) {
    const n = Number(value.length);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function extractAgentInsight(obj) {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  const requestId =
    pickRequestId(obj.requestId) ?? pickRequestId(obj.request_id);
  const appendSeqno = obj.appendSeqno ?? obj.append_seqno;
  const pollSeqno = obj.seqno;
  const eof = obj.eof === true;
  const dataPreview = previewDataField(obj.data);
  const dataBytes = dataBinaryByteLength(obj.dataBinary ?? obj.data_binary);

  if (
    requestId == null &&
    appendSeqno == null &&
    pollSeqno == null &&
    !eof &&
    !dataPreview &&
    dataBytes == null
  ) {
    return null;
  }

  return {
    requestId: requestId ?? undefined,
    appendSeqno: appendSeqno ?? undefined,
    pollSeqno: pollSeqno ?? undefined,
    eof: eof || undefined,
    dataPreview: dataPreview ?? undefined,
    dataBytes: dataBytes ?? undefined,
    streamingTokens: obj.streamingTokens ?? obj.streaming_tokens,
    inputTokens: obj.inputTokens ?? obj.input_tokens,
    outputTokens: obj.outputTokens ?? obj.output_tokens,
    cacheReadTokens: obj.cacheReadTokens ?? obj.cache_read_tokens,
    cacheWriteTokens: obj.cacheWriteTokens ?? obj.cache_write_tokens,
    usageEvent: obj.usageEvent ?? obj.usage_event,
  };
}
