import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { DEFAULT_MAX_BODY_LOG_BYTES } from './types';

export type BodyEncoding = 'utf8' | 'base64';

export interface FormattedBody {
  body?: string;
  bodyBase64?: string;
  bodyEncoding?: BodyEncoding;
  bodyTruncated?: boolean;
  bodyRawBytes?: number;
  /** Relative path under log dir, e.g. bodies/abc.bin */
  bodyFile?: string;
}

export interface BodyCaptureOptions {
  /** Max bytes to store inline in JSONL (base64 expands ~4/3). */
  maxInlineBytes?: number;
  /** When true, bodies larger than maxInlineBytes are written to logDir/bodies/ */
  spillLargeBodies?: boolean;
  logDir?: string;
  spillKey?: string;
  /** Redact known credential fields when persisting JSON bodies. */
  redactJsonFields?: boolean;
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
    lower.includes('event-stream') ||
    (lower.includes('connect') && !lower.includes('json'))
  );
}

function ensureBodiesDir(logDir: string): string {
  const bodiesDir = path.join(logDir, 'bodies');
  fs.mkdirSync(bodiesDir, { recursive: true });
  return bodiesDir;
}

function defaultSpillKey(): string {
  return `${Date.now()}-${randomBytes(6).toString('hex')}`;
}

function writeSpillFile(logDir: string, spillKey: string, buffer: Buffer): string {
  if (!/^[A-Za-z0-9._-]+$/.test(spillKey)) {
    throw new Error('Invalid spill key');
  }
  ensureBodiesDir(logDir);
  const fileName = `${spillKey}.bin`;
  const relPath = path.join('bodies', fileName);
  fs.writeFileSync(path.join(logDir, relPath), buffer);
  return relPath;
}

function formatInline(
  buffer: Buffer,
  contentType: string | undefined,
  maxInlineBytes: number,
  rawBytes = buffer.length
): FormattedBody {
  const binary = isBinaryContentType(contentType);

  if (binary) {
    const b64 = buffer.toString('base64');
    const b64Bytes = Buffer.byteLength(b64, 'utf8');
    if (b64Bytes <= maxInlineBytes) {
      return {
        bodyBase64: b64,
        bodyEncoding: 'base64',
        bodyRawBytes: rawBytes,
      };
    }
    const truncated = truncateBase64(b64, maxInlineBytes);
    return {
      bodyBase64: truncated,
      bodyEncoding: 'base64',
      bodyRawBytes: rawBytes,
      bodyTruncated: true,
    };
  }

  const text = buffer.toString('utf8');
  if (Buffer.byteLength(text, 'utf8') <= maxInlineBytes) {
    return {
      body: text,
      bodyEncoding: 'utf8',
      bodyRawBytes: rawBytes,
    };
  }

  return {
    body: truncateUtf8(text, maxInlineBytes),
    bodyEncoding: 'utf8',
    bodyRawBytes: rawBytes,
    bodyTruncated: true,
  };
}

const SENSITIVE_JSON_KEY_PATTERN = /^(authorization|proxy_?authorization|cookie|set_?cookie|api_?key|x-api-key|access_?token|refresh_?token|id_?token|client_?secret|password|secret)$/i;

function redactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactJsonValue);
  }
  if (value == null || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      SENSITIVE_JSON_KEY_PATTERN.test(key) ? '[REDACTED]' : redactJsonValue(child),
    ])
  );
}

function redactJsonBody(buffer: Buffer, contentType: string | undefined): Buffer {
  if (!contentType?.toLowerCase().includes('json')) {
    return buffer;
  }
  try {
    const parsed = JSON.parse(buffer.toString('utf8')) as unknown;
    return Buffer.from(JSON.stringify(redactJsonValue(parsed)), 'utf8');
  } catch {
    return buffer;
  }
}

/**
 * Capture request/response body for JSONL: inline up to maxInlineBytes, else spill to disk.
 */
export function captureBodyForLog(
  body: Buffer | string | undefined,
  contentType?: string,
  options: BodyCaptureOptions = {}
): FormattedBody {
  if (body == null) {
    return {};
  }

  const sourceBuffer =
    typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
  const rawBytes = sourceBuffer.length;
  const buffer = options.redactJsonFields
    ? redactJsonBody(sourceBuffer, contentType)
    : sourceBuffer;
  const maxInlineBytes = options.maxInlineBytes ?? DEFAULT_MAX_BODY_LOG_BYTES;
  const spill =
    options.spillLargeBodies !== false &&
    options.logDir != null &&
    rawBytes > maxInlineBytes;

  if (spill) {
    const spillKey = options.spillKey ?? defaultSpillKey();
    try {
      const bodyFile = writeSpillFile(options.logDir!, spillKey, buffer);
      return {
        bodyFile,
        bodyEncoding: isBinaryContentType(contentType) ? 'base64' : 'utf8',
        bodyRawBytes: rawBytes,
      };
    } catch {
      // fall through to inline truncate
    }
  }

  return formatInline(buffer, contentType, maxInlineBytes, rawBytes);
}

/**
 * Reconstruct raw body bytes from a log entry (inline or spill file).
 */
export function bodyBufferFromLogEntry(
  entry: {
    body?: string;
    bodyBase64?: string;
    bodyEncoding?: BodyEncoding;
    bodyFile?: string;
  },
  logDir?: string
): Buffer | null {
  if (entry.bodyFile && logDir) {
    try {
      if (path.isAbsolute(entry.bodyFile)) {
        return null;
      }
      const logRoot = path.resolve(logDir);
      const fullPath = path.resolve(logRoot, entry.bodyFile);
      const relative = path.relative(logRoot, fullPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return null;
      }
      const realRoot = fs.realpathSync(logRoot);
      const realPath = fs.realpathSync(fullPath);
      const realRelative = path.relative(realRoot, realPath);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        return null;
      }
      return fs.readFileSync(realPath);
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

function truncateBase64(b64: string, maxDecodedBytes: number): string {
  let maxB64Len = Math.ceil((maxDecodedBytes * 4) / 3);
  maxB64Len -= maxB64Len % 4;
  return b64.slice(0, maxB64Len);
}
