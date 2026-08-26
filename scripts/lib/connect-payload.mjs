/**
 * Connect framing helpers shared by proxy analysis and verification scripts.
 */

export function connectPayloadCandidates(body) {
  const candidates = new Set();
  const result = [];
  const add = (buf) => {
    const key = buf.toString('hex');
    if (!candidates.has(key)) {
      candidates.add(key);
      result.push(buf);
    }
  };

  add(body);
  let offset = 0;
  while (offset + 5 <= body.length) {
    const len = body.readUInt32BE(offset + 1);
    if (offset + 5 + len <= body.length) {
      add(body.subarray(offset + 5, offset + 5 + len));
    }
    offset += 5 + len;
  }

  if (body.length >= 5 && body[0] === 0) {
    const len = body.readUInt32BE(1);
    if (body.length >= 5 + len) {
      add(body.subarray(5, 5 + len));
    }
  }

  // Some historical captures contain a compact two-byte length prefix.
  if (body.length >= 3 && body[0] === 0) {
    const len = body.readUInt16BE(1);
    if (body.length >= 3 + len) {
      add(body.subarray(3, 3 + len));
    }
  }

  return result;
}
