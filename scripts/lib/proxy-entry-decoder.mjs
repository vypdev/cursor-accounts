/**
 * Decode one JSONL proxy capture entry into its JSON or protobuf object.
 */

import { bodyBufferFromEntry } from './proxy-log-body.mjs';
import { tryDecodeProto } from './proto-jsonl-verifier.mjs';

/**
 * @param {Record<string, any>} entry
 * @param {import('protobufjs').Type} Type
 * @param {string} logDir
 * @returns {Record<string, any> | null}
 */
export function decodeProxyEntry(entry, Type, logDir) {
  return isJsonEntry(entry)
    ? decodeJsonEntry(entry, logDir)
    : decodeProtobufEntry(entry, Type, logDir);
}

/**
 * @param {Record<string, any>} entry
 */
function isJsonEntry(entry) {
  return String(entry.headers?.['content-type'] ?? '')
    .toLowerCase()
    .includes('json');
}

/**
 * @param {Record<string, any>} entry
 * @param {string} logDir
 */
function decodeJsonEntry(entry, logDir) {
  const body =
    entry.body ?? bodyBufferFromEntry(entry, logDir)?.toString('utf8');
  if (!body) {
    return null;
  }
  try {
    const parsed = JSON.parse(body);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, any>} entry
 * @param {import('protobufjs').Type} Type
 * @param {string} logDir
 */
function decodeProtobufEntry(entry, Type, logDir) {
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
 * @param {unknown} value
 */
function isRecord(value) {
  return value !== null && typeof value === 'object';
}
