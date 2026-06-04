import { brotliDecompressSync, gunzipSync } from 'node:zlib';

export interface ConnectEnvelope {
  flags: number;
  length: number;
  payload: Buffer;
}

/**
 * Extract one or more protobuf payloads from Connect-RPC envelope framing.
 * Format: [flags: 1 byte][length: 4 bytes BE][payload: N bytes]
 */
export function stripConnectEnvelope(body: Buffer): Buffer[] {
  const payloads: Buffer[] = [];
  let offset = 0;

  while (offset < body.length) {
    if (body.length - offset < 5) {
      payloads.push(body.subarray(offset));
      break;
    }

    const flags = body.readUInt8(offset);
    const length = body.readUInt32BE(offset + 1);
    offset += 5;

    if (offset + length > body.length) {
      payloads.push(body.subarray(offset - 5));
      break;
    }

    payloads.push(body.subarray(offset, offset + length));
    offset += length;

    if (flags & 0x02) {
      break;
    }
  }

  return payloads.length > 0 ? payloads : [body];
}

/**
 * Additional candidates used when logging may have stripped partial envelopes.
 */
export function connectPayloadCandidates(body: Buffer): Buffer[] {
  const candidates = new Set<string>();
  const result: Buffer[] = [];

  const add = (buf: Buffer): void => {
    const key = buf.toString('hex');
    if (!candidates.has(key)) {
      candidates.add(key);
      result.push(buf);
    }
  };

  add(body);
  for (const payload of stripConnectEnvelope(body)) {
    add(payload);
  }

  if (body.length >= 5 && body[0] === 0) {
    const len = body.readUInt32BE(1);
    if (body.length >= 5 + len) {
      add(body.subarray(5, 5 + len));
    }
  }

  if (body.length >= 3 && body[0] === 0) {
    const len = body.readUInt16BE(1);
    if (body.length >= 3 + len) {
      add(body.subarray(3, 3 + len));
    }
  }

  return result;
}

/**
 * Decompress body according to Content-Encoding.
 */
export function decompressBody(
  body: Buffer,
  contentEncoding?: string
): Buffer {
  if (!contentEncoding || body.length === 0) {
    return body;
  }

  const encoding = (contentEncoding.split(',')[0] ?? contentEncoding).trim().toLowerCase();
  try {
    if (encoding === 'gzip' || encoding === 'x-gzip') {
      return gunzipSync(body);
    }
    if (encoding === 'br') {
      return brotliDecompressSync(body);
    }
  } catch {
    return body;
  }

  return body;
}

/**
 * Full pipeline: optional decompression then Connect envelope stripping.
 */
export function prepareConnectPayload(
  body: Buffer,
  contentEncoding?: string
): Buffer[] {
  const decompressed = decompressBody(body, contentEncoding);
  return connectPayloadCandidates(decompressed);
}

/** Build a Connect-RPC envelope around a protobuf payload (for tests and tooling). */
export function wrapConnectEnvelope(payload: Buffer, flags = 0): Buffer {
  const framed = Buffer.alloc(5 + payload.length);
  framed.writeUInt8(flags, 0);
  framed.writeUInt32BE(payload.length, 1);
  payload.copy(framed, 5);
  return framed;
}
