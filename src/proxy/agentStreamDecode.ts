import { gunzipSync } from 'node:zlib';
import { bidiDataToBuffer } from './bidiAgentDecode';
import { connectPayloadCandidates } from './connectDecode';
import type { ProtoRegistry } from './protoRegistry';
import {
  extractAgentInnerInsights,
  extractConversationAndSubagentIds,
  mergeAgentSessionInfo,
  type AgentSessionInfo,
} from './proxyInsightExtractor';

const MAX_CONNECT_FRAME_BYTES = 5_000_000;

export interface AgentStreamScanResult {
  messageCount: number;
  tokenDeltaCount: number;
  mergedAgent: AgentSessionInfo | null;
  relationshipIds: Partial<AgentSessionInfo>;
  /** Last decoded AgentServerMessage (for bodyDecoded preview). */
  lastMessage: Record<string, unknown> | null;
  /** All token_delta frames in stream order (for turn detection). */
  allTokenFrames: AgentSessionInfo[];
}

export function isAgentServerStreamRpc(
  rpcPath: string,
  direction: 'request' | 'response'
): boolean {
  return (
    direction === 'response' &&
    (rpcPath.includes('RunSSE') ||
      rpcPath.includes('StreamBidiSSE') ||
      (rpcPath.includes('StreamBidi') && !rpcPath.includes('StreamBidiPoll')))
  );
}

function decodeAgentMessageBytes(
  registry: ProtoRegistry,
  raw: Buffer
): Record<string, unknown> | null {
  const type = registry.lookupMessageType('agent.v1.AgentServerMessage');
  if (!type) {
    return null;
  }

  const candidates: Buffer[] = [raw];
  try {
    candidates.push(gunzipSync(raw));
  } catch {
    // not gzip
  }
  for (const candidate of candidates) {
    for (const framed of connectPayloadCandidates(candidate)) {
      try {
        return registry.decode(type, framed);
      } catch {
        // try next candidate
      }
    }
  }

  return null;
}

function decodeHealthWrappedAgentPayload(
  registry: ProtoRegistry,
  payload: Buffer
): Record<string, unknown> | null {
  const healthType = registry.lookupMessageType('aiserver.v1.HealthResponse');
  if (!healthType) {
    return null;
  }

  const candidates: Buffer[] = [payload];
  try {
    candidates.push(gunzipSync(payload));
  } catch {
    // not gzip
  }

  for (const candidate of candidates) {
    for (const framed of connectPayloadCandidates(candidate)) {
      try {
        const health = registry.decode(healthType, framed) as {
          payload?: unknown;
        };
        const inner = bidiDataToBuffer(health.payload);
        if (!inner?.length) {
          continue;
        }
        const agent = decodeAgentMessageBytes(registry, inner);
        if (agent) {
          return agent;
        }
      } catch {
        // try next candidate
      }
    }
  }

  return null;
}

/** Decode one Connect frame payload as AgentServerMessage (direct or HealthResponse-wrapped). */
export function decodeAgentServerPayload(
  registry: ProtoRegistry,
  payload: Buffer
): Record<string, unknown> | null {
  return (
    decodeAgentMessageBytes(registry, payload) ??
    decodeHealthWrappedAgentPayload(registry, payload)
  );
}

export function tryConnectFrame(
  body: Buffer,
  offset: number
): { payload: Buffer; nextOffset: number } | null {
  if (offset + 5 > body.length) {
    return null;
  }

  const length = body.readUInt32BE(offset + 1);
  if (length <= 0 || length > MAX_CONNECT_FRAME_BYTES) {
    return null;
  }
  if (offset + 5 + length > body.length) {
    return null;
  }

  return {
    payload: body.subarray(offset + 5, offset + 5 + length),
    nextOffset: offset + 5 + length,
  };
}

export function mergeAgentStreamFrameInsights(
  frames: AgentSessionInfo[]
): AgentSessionInfo | null {
  let latestDelta: AgentSessionInfo | null = null;
  let turnEnded: AgentSessionInfo | null = null;
  let tokenDetails: AgentSessionInfo | null = null;

  for (const frame of frames) {
    switch (frame.usageEvent) {
      case 'turn_ended':
        turnEnded = { ...frame };
        break;
      case 'token_delta':
        latestDelta = mergeAgentSessionInfo(latestDelta ?? undefined, frame) ?? frame;
        break;
      case 'token_details':
        tokenDetails = mergeAgentSessionInfo(tokenDetails ?? undefined, frame) ?? frame;
        break;
      default:
        break;
    }
  }

  return turnEnded ?? latestDelta ?? tokenDetails;
}

/**
 * Scan a Connect-framed AgentServerMessage stream (RunSSE / StreamBidi responses).
 * Cursor sends many framed messages in one HTTP response; only the first frame
 * decodes via the normal single-payload path (often a heartbeat).
 */
export function scanConnectAgentServerStream(
  registry: ProtoRegistry,
  body: Buffer
): AgentStreamScanResult {
  let messageCount = 0;
  let tokenDeltaCount = 0;
  const frameInsights: AgentSessionInfo[] = [];
  const tokenFrames: AgentSessionInfo[] = [];
  let relationshipIds: Partial<AgentSessionInfo> = {};
  let lastMessage: Record<string, unknown> | null = null;

  let offset = 0;
  while (offset < body.length) {
    const frame = tryConnectFrame(body, offset);
    if (!frame) {
      offset += 1;
      continue;
    }

    const decoded = decodeAgentServerPayload(registry, frame.payload);
    offset = frame.nextOffset;

    if (!decoded) {
      continue;
    }

    messageCount += 1;
    lastMessage = decoded;

    const ids = extractConversationAndSubagentIds(decoded);
    if (Object.keys(ids).length > 0) {
      relationshipIds = { ...relationshipIds, ...ids };
    }

    const insight = extractAgentInnerInsights(decoded);
    if (!insight) {
      continue;
    }

    frameInsights.push(insight);
    if (insight.usageEvent === 'token_delta') {
      tokenDeltaCount += 1;
      tokenFrames.push(insight);
    }
  }

  return {
    messageCount,
    tokenDeltaCount,
    mergedAgent: mergeAgentStreamFrameInsights(frameInsights),
    relationshipIds,
    lastMessage,
    allTokenFrames: tokenFrames,
  };
}
