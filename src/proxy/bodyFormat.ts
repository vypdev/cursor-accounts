import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { MAX_BODY_LOG_BYTES } from './types';

export type BodyEncoding = 'utf8' | 'base64';

export interface FormattedBody {
  body?: string;
  bodyBase64?: string;
  bodyEncoding?: BodyEncoding;
  bodyTruncated?: boolean;
  bodyRawBytes?: number;
}

function isBinaryContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }
  const lower = contentType.toLowerCase();
  return (
    lower.includes('proto') ||
    lower.includes('grpc') ||
    lower.includes('octet-stream') ||
    (lower.includes('connect') && !lower.includes('json'))
  );
}

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

/**
 * Format a body for JSONL logging. Binary/proto bodies are stored as Base64.
 */
export function formatBodyForLog(
  body: Buffer | string | undefined,
  contentType?: string
): FormattedBody {
  if (body == null) {
    return {};
  }

  const buffer =
    typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
  const rawBytes = buffer.length;

  if (isBinaryContentType(contentType)) {
    const b64 = buffer.toString('base64');
    const truncated = rawBytes > MAX_BODY_LOG_BYTES;
    const bodyBase64 = truncated
      ? truncateBase64(b64, MAX_BODY_LOG_BYTES)
      : b64;
    return {
      bodyBase64,
      bodyEncoding: 'base64',
      bodyRawBytes: rawBytes,
      bodyTruncated: truncated || undefined,
    };
  }

  const text = buffer.toString('utf8');
  if (Buffer.byteLength(text, 'utf8') <= MAX_BODY_LOG_BYTES) {
    return {
      body: text,
      bodyEncoding: 'utf8',
      bodyRawBytes: rawBytes,
    };
  }

  const truncatedText = truncateUtf8(text, MAX_BODY_LOG_BYTES);
  return {
    body: truncatedText,
    bodyEncoding: 'utf8',
    bodyRawBytes: rawBytes,
    bodyTruncated: true,
  };
}

/**
 * Reconstruct raw body bytes from a log entry.
 */
export function bodyBufferFromLogEntry(entry: {
  body?: string;
  bodyBase64?: string;
  bodyEncoding?: BodyEncoding;
}): Buffer | null {
  if (entry.bodyBase64) {
    return Buffer.from(entry.bodyBase64, 'base64');
  }
  if (entry.body != null && entry.body.length > 0) {
    return Buffer.from(entry.body, entry.bodyEncoding === 'utf8' ? 'utf8' : 'latin1');
  }
  return null;
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, mid), 'utf8') <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, low);
}

/** Truncate base64 so decoded size is at most maxDecodedBytes (approximate). */
function truncateBase64(b64: string, maxDecodedBytes: number): string {
  const maxB64Len = Math.ceil((maxDecodedBytes * 4) / 3);
  return b64.slice(0, maxB64Len);
}
