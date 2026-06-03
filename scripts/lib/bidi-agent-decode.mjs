/**
 * Decode nested agent frames inside BidiAppend / RunPoll `data` (hex protobuf).
 */

import protobuf from 'protobufjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectPayloadCandidates } from './connect-payload.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

let rootPromise;

function getRoot() {
  if (!rootPromise) {
    rootPromise = protobuf.load([
      path.join(REPO_ROOT, 'proto/agent/v1/agent.proto'),
      path.join(REPO_ROOT, 'proto/aiserver/v1/aiserver.proto'),
    ]);
  }
  return rootPromise;
}

export function bidiDataToBuffer(data, dataBinary) {
  if (dataBinary != null && typeof dataBinary === 'string') {
    if (/^[0-9a-f]+$/i.test(dataBinary) && dataBinary.length % 2 === 0) {
      return Buffer.from(dataBinary, 'hex');
    }
    return Buffer.from(dataBinary, 'base64');
  }
  if (typeof data !== 'string' || !data.length) {
    return null;
  }
  const trimmed = data.trim();
  if (/^[0-9a-f]+$/i.test(trimmed) && trimmed.length % 2 === 0) {
    return Buffer.from(trimmed, 'hex');
  }
  return Buffer.from(trimmed, 'utf8');
}

export function bidiInnerRoleForRpc(rpcPath, direction) {
  if (!rpcPath.includes('BidiAppend') && !rpcPath.includes('RunPoll') && !rpcPath.includes('BidiPoll')) {
    return null;
  }
  if (rpcPath.includes('BidiAppend')) {
    return direction === 'request' ? 'client' : 'server';
  }
  return direction === 'response' ? 'server' : 'client';
}

/**
 * @param {Record<string, unknown>} outerDecoded
 * @param {string} rpcPath
 * @param {'request' | 'response'} direction
 */
export async function decodeBidiAgentInner(outerDecoded, rpcPath, direction) {
  const role = bidiInnerRoleForRpc(rpcPath, direction);
  if (!role) {
    return null;
  }
  const raw = bidiDataToBuffer(
    outerDecoded.data,
    outerDecoded.dataBinary ?? outerDecoded.data_binary
  );
  if (!raw?.length) {
    return null;
  }
  const root = await getRoot();
  const typeName =
    role === 'server'
      ? 'agent.v1.AgentServerMessage'
      : 'agent.v1.AgentClientMessage';
  const Type = root.lookupType(typeName);
  for (const payload of connectPayloadCandidates(raw)) {
    try {
      const msg = Type.decode(payload);
      return Type.toObject(msg, {
        longs: String,
        enums: String,
        bytes: String,
        defaults: false,
      });
    } catch {
      // continue
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} inner
 */
export function extractAgentInnerInsight(inner) {
  const upd = inner.interactionUpdate ?? inner.interaction_update;
  if (!upd || typeof upd !== 'object') {
    return null;
  }
  const tokenDelta = upd.tokenDelta ?? upd.token_delta;
  if (tokenDelta && typeof tokenDelta === 'object') {
    const tokens = Number(tokenDelta.tokens);
    if (Number.isFinite(tokens)) {
      return { streamingTokens: tokens, usageEvent: 'token_delta' };
    }
  }
  const turn = upd.turnEnded ?? upd.turn_ended;
  if (turn && typeof turn === 'object') {
    return {
      inputTokens: turn.inputTokens ?? turn.input_tokens,
      outputTokens: turn.outputTokens ?? turn.output_tokens,
      cacheReadTokens: turn.cacheReadTokens ?? turn.cache_read_tokens,
      cacheWriteTokens: turn.cacheWriteTokens ?? turn.cache_write_tokens,
      usageEvent: 'turn_ended',
    };
  }
  return null;
}
