import type { AgentSessionInfo } from '../../application/types/agentTracking';
import type { WorkspaceInfo } from '../../application/types/proxyInsights';
export { mergeAgentSessionInfo } from '../../domain/services/agentSessionInfo';
import { asNumber, pickField } from './fieldNormalization';

const DATA_PREVIEW_MAX = 240;
/** Reject turn_ended fields above this (guards UTF-8-corrupted JSONL replay). */
export const MAX_SANE_TURN_TOKENS = 50_000_000;

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

function dataBinaryByteLength(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value.length;
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return value.length;
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  if (typeof value === 'object' && value !== null && 'length' in value) {
    const n = Number(value.length);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function pickRequestId(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const nested = record.requestId ?? record.request_id;
    if (typeof nested === 'string' && nested.length > 0) {
      return nested;
    }
  }
  return undefined;
}

function pickTurnEnded(value: unknown): {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalCents?: number;
} | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const inputTokens = asNumber(record.inputTokens ?? record.input_tokens);
  const outputTokens = asNumber(record.outputTokens ?? record.output_tokens);
  const cacheReadTokens = asNumber(
    record.cacheReadTokens ?? record.cache_read_tokens
  );
  const cacheWriteTokens = asNumber(
    record.cacheWriteTokens ?? record.cache_write_tokens
  );
  const totalCents = asNumber(record.totalCents ?? record.total_cents);
  if (inputTokens != null && inputTokens > MAX_SANE_TURN_TOKENS) {
    return null;
  }
  if (outputTokens != null && outputTokens > MAX_SANE_TURN_TOKENS) {
    return null;
  }
  if (cacheReadTokens != null && cacheReadTokens > MAX_SANE_TURN_TOKENS) {
    return null;
  }
  if (cacheWriteTokens != null && cacheWriteTokens > MAX_SANE_TURN_TOKENS) {
    return null;
  }
  if (
    inputTokens == null &&
    outputTokens == null &&
    cacheReadTokens == null &&
    cacheWriteTokens == null &&
    totalCents == null
  ) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalCents,
  };
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

function pickStringField(
  decoded: Record<string, unknown>,
  snake: string,
  camel: string
): string | undefined {
  const value = pickField(decoded, snake, camel);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Extract workspace identifiers from an agent RPC payload. */
export function extractWorkspaceInfo(
  decoded: Record<string, unknown>
): WorkspaceInfo | null {
  const privateWorkspace = decoded.private_workspace_identifier as
    | Record<string, unknown>
    | undefined;
  const workspaceId =
    pickStringField(decoded, 'workspace_id', 'workspaceId') ??
    (typeof privateWorkspace?.workspace_id === 'string'
      ? privateWorkspace.workspace_id
      : typeof privateWorkspace?.workspaceId === 'string'
        ? privateWorkspace.workspaceId
        : undefined);
  const workspaceRootPath = pickStringField(
    decoded,
    'workspace_root_path',
    'workspaceRootPath'
  );
  const relativeWorkspacePath = pickStringField(
    decoded,
    'relative_workspace_path',
    'relativeWorkspacePath'
  );

  if (!workspaceId && !workspaceRootPath && !relativeWorkspacePath) {
    return null;
  }

  return {
    workspaceId,
    workspaceRootPath,
    relativeWorkspacePath,
  };
}

/** Drop explicit `undefined` entries so spreads/merges never erase populated fields. */
export function definedAgentFields(
  fields: Partial<AgentSessionInfo>
): Partial<AgentSessionInfo> {
  const out: Partial<AgentSessionInfo> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/** Extract model and session fields from AgentClientMessage.runRequest. */
export function extractAgentRunRequestInfo(
  decoded: Record<string, unknown>
): Partial<AgentSessionInfo> | null {
  const runRequest = pickField(decoded, 'run_request', 'runRequest');
  if (!runRequest || typeof runRequest !== 'object') {
    return null;
  }

  const req = runRequest as Record<string, unknown>;
  const requestedModel = (req.requestedModel ?? req.requested_model) as
    | Record<string, unknown>
    | undefined;
  const modelDetails = (req.modelDetails ?? req.model_details) as
    | Record<string, unknown>
    | undefined;

  const requestedModelId =
    pickStringField(requestedModel ?? {}, 'model_id', 'modelId') ??
    pickStringField(modelDetails ?? {}, 'model_id', 'modelId');

  const modelDisplayName = pickStringField(
    modelDetails ?? {},
    'display_name',
    'displayName'
  );

  const subagentTypeName = pickStringField(
    req,
    'subagent_type_name',
    'subagentTypeName'
  );

  const requestId =
    pickRequestId(req.requestId ?? req.request_id) ??
    pickStringField(req, 'request_id', 'requestId');

  if (
    !requestedModelId &&
    !modelDisplayName &&
    !subagentTypeName &&
    !requestId
  ) {
    return null;
  }

  return definedAgentFields({
    requestId,
    requestedModelId,
    modelDisplayName,
    subagentTypeName,
    modelName: requestedModelId ?? modelDisplayName,
  });
}

/** Extract conversation and subagent linkage from nested Agent bidi messages. */
export function extractConversationAndSubagentIds(
  decoded: Record<string, unknown>
): Partial<AgentSessionInfo> {
  const result: Partial<AgentSessionInfo> = {};

  const runRequest = pickField(decoded, 'run_request', 'runRequest');
  if (runRequest && typeof runRequest === 'object') {
    const req = runRequest as Record<string, unknown>;
    const conversationId = pickStringField(req, 'conversation_id', 'conversationId');
    if (conversationId) {
      result.conversationId = conversationId;
    }
    const conversationGroupId = pickStringField(
      req,
      'conversation_group_id',
      'conversationGroupId'
    );
    if (conversationGroupId) {
      result.conversationGroupId = conversationGroupId;
    }
    const parentRequestId = pickStringField(
      req,
      'parent_request_id',
      'parentRequestId'
    );
    if (parentRequestId) {
      result.parentRequestId = parentRequestId;
    }
    const subagentRequestId = pickStringField(
      req,
      'subagent_request_id',
      'subagentRequestId'
    );
    if (subagentRequestId) {
      result.subagentRequestId = subagentRequestId;
    }
  }

  const prewarmRequest = pickField(decoded, 'prewarm_request', 'prewarmRequest');
  if (prewarmRequest && typeof prewarmRequest === 'object') {
    const req = prewarmRequest as Record<string, unknown>;
    result.conversationId ??= pickStringField(req, 'conversation_id', 'conversationId');
    result.conversationGroupId ??= pickStringField(
      req,
      'conversation_group_id',
      'conversationGroupId'
    );
  }

  const subagentResult = pickField(decoded, 'subagent_result', 'subagentResult');
  if (subagentResult && typeof subagentResult === 'object') {
    const resultObj = subagentResult as Record<string, unknown>;
    const success = pickField(resultObj, 'success', 'success');
    if (success && typeof success === 'object') {
      const successObj = success as Record<string, unknown>;
      result.subagentRequestId ??= pickStringField(successObj, 'agent_id', 'agentId');
    }
  }

  const taskArgs = pickField(decoded, 'task_tool_call_args', 'taskToolCallArgs');
  if (taskArgs && typeof taskArgs === 'object') {
    const args = taskArgs as Record<string, unknown>;
    result.parentRequestId ??= pickStringField(
      args,
      'parent_request_id',
      'parentRequestId'
    );
    result.subagentRequestId ??= pickStringField(
      args,
      'subagent_request_id',
      'subagentRequestId'
    );
  }

  return result;
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
    !requestId &&
    appendSeqno == null &&
    pollSeqno == null &&
    !eof &&
    !dataPreview &&
    dataBytes == null
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
