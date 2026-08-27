/**
 * Calculate token-oriented metrics from decoded Agent messages.
 */

const MAX_SANE_TURN_TOKENS = 50_000_000;

const EMPTY_STREAM_METRICS = Object.freeze({
  textDeltaChars: 0,
  thinkingDeltaChars: 0,
  tokenDeltaEvents: 0,
  tokenDeltaPeak: 0,
  turnEndedEvents: 0,
  turnEndedInput: 0,
  turnEndedOutput: 0,
});

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
  const total = {
    textDeltaChars: 0,
    thinkingDeltaChars: 0,
    tokenDeltaEvents: 0,
    tokenDeltaPeak: 0,
    turnEndedEvents: 0,
    turnEndedInput: 0,
    turnEndedOutput: 0,
  };

  for (const message of messages) {
    addStreamMetrics(total, streamMetricsForMessage(message));
  }

  return total;
}

function streamMetricsForMessage(message) {
  const update = interactionUpdateOf(message);
  if (!update) {
    return EMPTY_STREAM_METRICS;
  }

  const tokenDelta = tokenDeltaValue(update);
  const turnEnded = turnEndedMetrics(update);
  return {
    textDeltaChars: textLength(update, 'textDelta', 'text_delta'),
    thinkingDeltaChars: textLength(update, 'thinkingDelta', 'thinking_delta'),
    tokenDeltaEvents: tokenDelta === null ? 0 : 1,
    tokenDeltaPeak: tokenDelta ?? 0,
    turnEndedEvents: turnEnded.eventCount,
    turnEndedInput: turnEnded.input,
    turnEndedOutput: turnEnded.output,
  };
}

function interactionUpdateOf(message) {
  if (!message || typeof message !== 'object') {
    return null;
  }
  const update = message.interactionUpdate ?? message.interaction_update;
  return isObject(update) ? update : null;
}

function textLength(update, primaryKey, fallbackKey) {
  const delta = update[primaryKey] ?? update[fallbackKey];
  return isObject(delta) && delta.text != null ? String(delta.text).length : 0;
}

function tokenDeltaValue(update) {
  const delta = update.tokenDelta ?? update.token_delta;
  if (!isObject(delta)) {
    return null;
  }
  const value = Number(delta.tokens);
  return Number.isFinite(value) ? value : null;
}

function turnEndedMetrics(update) {
  const turnEnded = update.turnEnded ?? update.turn_ended;
  if (!isObject(turnEnded)) {
    return { eventCount: 0, input: 0, output: 0 };
  }
  const input = saneTokenCount(turnEnded.inputTokens ?? turnEnded.input_tokens);
  const output = saneTokenCount(turnEnded.outputTokens ?? turnEnded.output_tokens);
  return {
    eventCount: input > 0 || output > 0 ? 1 : 0,
    input,
    output,
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function addStreamMetrics(total, current) {
  total.textDeltaChars += current.textDeltaChars;
  total.thinkingDeltaChars += current.thinkingDeltaChars;
  total.tokenDeltaEvents += current.tokenDeltaEvents;
  total.tokenDeltaPeak = Math.max(total.tokenDeltaPeak, current.tokenDeltaPeak);
  total.turnEndedEvents += current.turnEndedEvents;
  total.turnEndedInput += current.turnEndedInput;
  total.turnEndedOutput += current.turnEndedOutput;
}

/**
 * Dedupe preFetched blob values across BidiAppend client messages.
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
