import type { Type } from 'protobufjs';
import {
  isAgentServerStreamRpc,
} from './agentStreamDecode';
import {
  connectPayloadCandidates,
  prepareConnectPayload,
} from './connectDecode';
import {
  enrichInsightsFromAgentStream,
} from './proxyInsightEnricher';
import {
  buildDecodedResult,
} from './proxyDecodedResultBuilder';
import {
  getProtoRegistry,
  type ProtoRegistry,
} from './protoRegistry';
import { messageTypeName } from './proxyRpcPath';
import type {
  DecodeContext,
  DecodeProtoResult,
} from './proxyDecodeTypes';
import type { ProxyLogEntry } from './types';

const RPC_PATH_RE =
  /\/((?:aiserver|agent)\.v1\.[A-Za-z0-9_]+)\/([A-Za-z0-9_]+)/;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveMessageType(
  registry: ProtoRegistry,
  rpcPath: string,
  direction: ProxyLogEntry['direction']
): Type | undefined {
  const types = registry.getRpcTypes(rpcPath);
  if (types) {
    return direction === 'request' ? types.requestType : types.responseType;
  }

  const match = rpcPath.match(RPC_PATH_RE);
  const methodName = match?.[2];
  if (!methodName) {
    return undefined;
  }

  const typeName = messageTypeName(
    methodName,
    direction === 'request' ? 'request' : 'response'
  );
  return registry.lookupMessageType(typeName) ?? undefined;
}

function decodePayloads(
  registry: ProtoRegistry,
  type: Type,
  payloads: Buffer[]
): { decoded?: Record<string, unknown>; error?: string } {
  let lastError: string | undefined;
  for (const payload of payloads) {
    try {
      return { decoded: registry.decode(type, payload) };
    } catch (error) {
      lastError = errorMessage(error);
    }
  }
  return { error: lastError };
}

function payloadCandidates(
  entry: ProxyLogEntry,
  rawBody: Buffer,
  contentEncoding: string | undefined
): Buffer[] {
  return entry.bodyDecompressed
    ? connectPayloadCandidates(rawBody)
    : prepareConnectPayload(rawBody, contentEncoding);
}

function decodeFailure(
  rpcPath: string,
  error: string | undefined
): DecodeProtoResult {
  return {
    error: error ?? 'decode failed',
    rpcPath,
  };
}

async function decodeAgentStreamFallback(
  context: DecodeContext,
  entry: ProxyLogEntry,
  error: string | undefined
): Promise<DecodeProtoResult> {
  if (
    (entry.direction !== 'request' && entry.direction !== 'response') ||
    !isAgentServerStreamRpc(context.rpcPath, entry.direction)
  ) {
    return decodeFailure(context.rpcPath, error);
  }

  const insights = await enrichInsightsFromAgentStream(
    context.rpcPath,
    entry.direction,
    context.rawBody,
    context.contentEncoding,
    undefined
  );
  if (insights && (insights.agent || insights.tokens)) {
    return { insights, rpcPath: context.rpcPath };
  }

  return decodeFailure(context.rpcPath, error);
}

export async function decodeBinaryPayloads(
  entry: ProxyLogEntry,
  context: DecodeContext
): Promise<DecodeProtoResult> {
  try {
    const registry = await getProtoRegistry();
    const type = resolveMessageType(registry, context.rpcPath, entry.direction);
    if (!type) {
      return { error: `Unknown RPC: ${context.rpcPath}`, rpcPath: context.rpcPath };
    }

    const decoded = decodePayloads(
      registry,
      type,
      payloadCandidates(entry, context.rawBody, context.contentEncoding)
    );
    if (decoded.decoded) {
      return buildDecodedResult(context, decoded.decoded);
    }

    return decodeAgentStreamFallback(context, entry, decoded.error);
  } catch (error) {
    return {
      error: errorMessage(error),
      rpcPath: context.rpcPath,
    };
  }
}
