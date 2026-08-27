/**
 * Decode Connect-framed Agent bidi / RunSSE protobuf streams.
 */

import zlib from 'node:zlib';
import { connectPayloadCandidates } from './connect-payload.mjs';

const MAX_CONNECT_FRAME_BYTES = 5_000_000;

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
  for (const candidate of compressionCandidates(payload)) {
    const decoded = decodePayloadCandidate(Type, candidate);
    if (decoded) {
      return decoded;
    }
  }
  return null;
}

/**
 * @param {Buffer} payload
 * @returns {Buffer[]}
 */
function compressionCandidates(payload) {
  /** @type {Buffer[]} */
  const candidates = [payload];
  try {
    candidates.push(zlib.gunzipSync(payload));
  } catch {
    // Not gzip; the raw candidate remains valid.
  }
  return candidates;
}

/**
 * @param {import('protobufjs').Type} Type
 * @param {Buffer} candidate
 */
function decodePayloadCandidate(Type, candidate) {
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
      // Try the next framing candidate.
    }
  }
  return null;
}

/**
 * Scan a RunSSE / StreamBidi AgentServerMessage stream.
 *
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
 * Decode standard Connect frames without the AgentServerMessage gzip fallback.
 *
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
      // The caller may retry this frame with another decoder.
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
