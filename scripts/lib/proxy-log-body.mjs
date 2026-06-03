/**
 * Shared helpers for reading proxy JSONL body fields (utf8 or base64).
 */

/**
 * @param {{ body?: string, bodyBase64?: string, bodyEncoding?: string }} entry
 * @returns {Buffer | null}
 */
export function bodyBufferFromEntry(entry) {
  if (entry.bodyBase64) {
    return Buffer.from(entry.bodyBase64, 'base64');
  }
  if (entry.body != null && entry.body.length > 0) {
    return Buffer.from(entry.body, entry.bodyEncoding === 'utf8' ? 'utf8' : 'latin1');
  }
  return null;
}
