import type { AgentSessionInfo } from '../../application/types/agentTracking';
import { asNumber } from './fieldNormalization';
import {
  definedAgentFields,
  pickRequestId,
} from './agentExtractionSupport';

const DATA_PREVIEW_MAX = 240;
/** Reject turn_ended fields above this (guards UTF-8-corrupted JSONL replay). */
export const MAX_SANE_TURN_TOKENS = 50_000_000;

type TurnEndedUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalCents?: number;
};

function previewDataField(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length <= DATA_PREVIEW_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, DATA_PREVIEW_MAX)}…`;
}

function hasLength(value: unknown): value is { length: number } {
  return Boolean(
    typeof value === 'string' ||
      value instanceof Uint8Array ||
      Array.isArray(value) ||
      (typeof value === 'object' && value !== null && 'length' in value)
  );
}

function dataBinaryByteLength(value: unknown): number | undefined {
  if (!hasLength(value)) {
    return undefined;
  }
  const length = Number(value.length);
  return Number.isFinite(length) ? length : undefined;
}

function pickNumericField(
  record: Record<string, unknown>,
  camel: string,
  snake: string
): number | undefined {
  return asNumber(record[camel] ?? record[snake]);
}

function hasSaneTokenCounts(turn: TurnEndedUsage): boolean {
  return [
    turn.inputTokens,
    turn.outputTokens,
    turn.cacheReadTokens,
    turn.cacheWriteTokens,
  ].every(
    (tokens) => tokens == null || tokens <= MAX_SANE_TURN_TOKENS
  );
}

function hasTurnEndedUsage(turn: TurnEndedUsage): boolean {
  return Object.values(turn).some((value) => value != null);
}

function pickTurnEnded(value: unknown): TurnEndedUsage | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const turn: TurnEndedUsage = {
    inputTokens: pickNumericField(record, 'inputTokens', 'input_tokens'),
    outputTokens: pickNumericField(record, 'outputTokens', 'output_tokens'),
    cacheReadTokens: pickNumericField(
      record,
      'cacheReadTokens',
      'cache_read_tokens'
    ),
    cacheWriteTokens: pickNumericField(
      record,
      'cacheWriteTokens',
      'cache_write_tokens'
    ),
    totalCents: pickNumericField(record, 'totalCents', 'total_cents'),
  };
  if (!hasSaneTokenCounts(turn) || !hasTurnEndedUsage(turn)) {
    return null;
  }
  return turn;
}

function hasSessionData(
  fields: Pick<
    AgentSessionInfo,
    'requestId' | 'appendSeqno' | 'pollSeqno' | 'eof' | 'dataPreview' | 'dataBytes'
  >
): boolean {
  return Boolean(
    fields.requestId ||
      fields.appendSeqno != null ||
      fields.pollSeqno != null ||
      fields.eof ||
      fields.dataPreview ||
      fields.dataBytes != null
  );
}

/** Extract usage from nested AgentServerMessage / AgentClientMessage (Bidi `data`). */
export function extractAgentInnerInsights(
  inner: Record<string, unknown>
): AgentSessionInfo | null {
  const interactionUpdate = (inner.interactionUpdate ??
    inner.interaction_update) as Record<string, unknown> | undefined;

  if (interactionUpdate) {
    const tokenDelta = (interactionUpdate.tokenDelta ??
      interactionUpdate.token_delta) as Record<string, unknown> | undefined;
    const streamingTokens = asNumber(tokenDelta?.tokens);
    const turn = pickTurnEnded(
      interactionUpdate.turnEnded ?? interactionUpdate.turn_ended
    );

    if (streamingTokens != null) {
      return {
        streamingTokens,
        usageEvent: 'token_delta',
      };
    }
    if (turn) {
      return {
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        cacheReadTokens: turn.cacheReadTokens,
        cacheWriteTokens: turn.cacheWriteTokens,
        totalCents: turn.totalCents,
        usageEvent: 'turn_ended',
      };
    }
  }

  const checkpoint = (inner.conversationCheckpointUpdate ??
    inner.conversation_checkpoint_update) as Record<string, unknown> | undefined;
  const tokenDetails = (checkpoint?.tokenDetails ??
    checkpoint?.token_details) as Record<string, unknown> | undefined;
  const usedTokens = asNumber(
    tokenDetails?.usedTokens ?? tokenDetails?.used_tokens
  );
  const maxTokens = asNumber(
    tokenDetails?.maxTokens ?? tokenDetails?.max_tokens
  );
  if (usedTokens != null) {
    return {
      streamingTokens: usedTokens,
      contextUsedTokens: usedTokens,
      maxTokens: maxTokens ?? undefined,
      usageEvent: 'token_details',
    };
  }

  return null;
}

export function estimateTokenCostUsd(
  tokens: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    streamingTokens?: number;
  },
  dollarsPerMillionTokens: number
): number | undefined {
  const billed =
    (tokens.inputTokens ?? 0) +
    (tokens.outputTokens ?? 0) +
    (tokens.cacheReadTokens ?? 0) +
    (tokens.cacheWriteTokens ?? 0);
  const total = billed > 0 ? billed : tokens.streamingTokens;
  if (total == null || total <= 0 || dollarsPerMillionTokens <= 0) {
    return undefined;
  }
  return (total / 1_000_000) * dollarsPerMillionTokens;
}

/** Extract Agent bidi session fields from BidiAppend / BidiPoll / RunPoll payloads. */
export function extractAgentSessionInfo(
  decoded: Record<string, unknown>
): AgentSessionInfo | null {
  const requestId =
    pickRequestId(decoded.requestId) ??
    pickRequestId(decoded.request_id);
  const appendSeqno = asNumber(decoded.appendSeqno ?? decoded.append_seqno);
  const pollSeqno = asNumber(decoded.seqno);
  const eof = decoded.eof === true;
  const dataPreview = previewDataField(decoded.data);
  const dataBytes = dataBinaryByteLength(
    decoded.dataBinary ?? decoded.data_binary
  );

  if (
    !hasSessionData({
      requestId,
      appendSeqno,
      pollSeqno,
      eof,
      dataPreview,
      dataBytes,
    })
  ) {
    return null;
  }

  return definedAgentFields({
    requestId,
    appendSeqno,
    pollSeqno,
    eof: eof || undefined,
    dataPreview,
    dataBytes,
  });
}
