/**
 * Shared helpers for reading proxy JSONL body fields (utf8, base64, or spill file).
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {{ body?: string, bodyBase64?: string, bodyEncoding?: string, bodyFile?: string }} entry
 * @param {string} [logDir]
 * @returns {Buffer | null}
 */
export function bodyBufferFromEntry(entry, logDir) {
  if (entry.bodyFile && logDir) {
    try {
      const fullPath = path.isAbsolute(entry.bodyFile)
        ? entry.bodyFile
        : path.join(logDir, entry.bodyFile);
      return fs.readFileSync(fullPath);
    } catch {
      return null;
    }
  }

  if (entry.bodyBase64) {
    return Buffer.from(entry.bodyBase64, 'base64');
  }
  if (entry.body != null && entry.body.length > 0) {
    return Buffer.from(entry.body, entry.bodyEncoding === 'utf8' ? 'utf8' : 'latin1');
  }
  return null;
}
