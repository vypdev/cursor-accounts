import type { Type } from 'protobufjs';
import { connectPayloadCandidates } from './connectDecode';
import type { ProtoRegistry } from './protoRegistry';

export type BidiInnerRole = 'client' | 'server';

/**
 * BidiAppend / BidiPoll carry nested agent frames in `data` (often hex-encoded protobuf).
 */
export function bidiDataToBuffer(
  data: unknown,
  dataBinary?: unknown
): Buffer | null {
  if (dataBinary != null) {
    if (typeof dataBinary === 'string') {
      if (/^[0-9a-f]+$/i.test(dataBinary) && dataBinary.length % 2 === 0) {
        return Buffer.from(dataBinary, 'hex');
      }
      return Buffer.from(dataBinary, 'base64');
    }
    if (Buffer.isBuffer(dataBinary) || dataBinary instanceof Uint8Array) {
      return Buffer.from(dataBinary);
    }
  }

  if (typeof data !== 'string' || data.length === 0) {
    return null;
  }

  const trimmed = data.trim();
  if (/^[0-9a-f]+$/i.test(trimmed) && trimmed.length % 2 === 0) {
    return Buffer.from(trimmed, 'hex');
  }

  return Buffer.from(trimmed, 'utf8');
}

function decodeWithType(type: Type, raw: Buffer): Record<string, unknown> | null {
  for (const payload of connectPayloadCandidates(raw)) {
    try {
      const message = type.decode(payload);
      return type.toObject(message, {
        longs: String,
        enums: String,
        bytes: String,
        defaults: false,
        arrays: true,
        objects: true,
        oneofs: true,
      }) as Record<string, unknown>;
    } catch {
      // try next framing candidate
    }
  }
  return null;
}

/**
 * Decode nested AgentClientMessage / AgentServerMessage from Bidi `data` fields.
 */
export function decodeBidiAgentPayload(
  registry: ProtoRegistry,
  data: unknown,
  dataBinary: unknown,
  role: BidiInnerRole
): Record<string, unknown> | null {
  const raw = bidiDataToBuffer(data, dataBinary);
  if (!raw || raw.length === 0) {
    return null;
  }

  const typeName =
    role === 'server'
      ? 'agent.v1.AgentServerMessage'
      : 'agent.v1.AgentClientMessage';
  const type = registry.lookupMessageType(typeName);
  if (!type) {
    return null;
  }

  return decodeWithType(type, raw);
}

export function isBidiCarrierRpc(rpcPath: string): boolean {
  return (
    rpcPath.includes('BidiAppend') ||
    rpcPath.includes('BidiPoll') ||
    rpcPath.includes('RunPoll') ||
    rpcPath.includes('StreamBidi')
  );
}

export function bidiInnerRoleForRpc(
  rpcPath: string,
  direction: 'request' | 'response'
): BidiInnerRole | null {
  if (!isBidiCarrierRpc(rpcPath)) {
    return null;
  }
  if (rpcPath.includes('BidiAppend')) {
    return direction === 'request' ? 'client' : 'server';
  }
  // RunPoll / BidiPoll: client polls, server responds with AgentServerMessage frames
  return direction === 'response' ? 'server' : 'client';
}
