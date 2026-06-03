import { brotliDecompressSync, gunzipSync } from 'node:zlib';

export type { BodyEncoding, FormattedBody } from './bodyCapture';
export { bodyBufferFromLogEntry, captureBodyForLog } from './bodyCapture';

/**
 * Decompress response/request body when Content-Encoding is gzip or br.
 */
export function decompressBodyBuffer(
  body: Buffer,
  contentEncoding: string | undefined
): { body: Buffer; decompressed: boolean } {
  if (!contentEncoding || body.length === 0) {
    return { body, decompressed: false };
  }

  const encoding = (contentEncoding.split(',')[0] ?? contentEncoding).trim().toLowerCase();
  try {
    if (encoding === 'gzip' || encoding === 'x-gzip') {
      return { body: gunzipSync(body), decompressed: true };
    }
    if (encoding === 'br') {
      return { body: brotliDecompressSync(body), decompressed: true };
    }
  } catch {
    return { body, decompressed: false };
  }

  return { body, decompressed: false };
}
