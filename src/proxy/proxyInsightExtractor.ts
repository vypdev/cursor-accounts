import type { AgentSessionInfo } from '../application/types/agentTracking';

export type { AgentSessionInfo } from '../application/types/agentTracking';
import type {
  BillingInfo,
  ConversationContext,
  ProxyInsights,
  TokenUsageInfo,
} from '../application/types/proxyInsights';

export type {
  BillingInfo,
  ConversationContext,
  ProxyInsights,
  TokenUsageInfo,
} from '../application/types/proxyInsights';

function asNumber(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function centsToUsd(cents: unknown): number | undefined {
  const n = asNumber(cents);
  return n != null ? n / 100 : undefined;
}

function pickField(
  decoded: Record<string, unknown>,
  snake: string,
  camel: string
): unknown {
  if (decoded[snake] !== undefined) {
    return decoded[snake];
  }
  return decoded[camel];
}

function isoFromTimestamp(value: unknown): string | undefined {
  const n = asNumber(value);
  if (n == null) {
    return undefined;
  }
  const ms = n > 1e12 ? n : n * 1000;
  return new Date(ms).toISOString();
}

function hasBillingData(info: BillingInfo): boolean {
  return Boolean(
    info.billingCycleStart ??
      info.billingCycleEnd ??
      info.planUsage ??
      info.spendLimit
  );
}

/**
 * Extract billing fields from GetCurrentPeriodUsageResponse-shaped objects.
 */
export function extractBillingInfo(decoded: Record<string, unknown> | null | undefined): BillingInfo | null {
  if (!decoded) {
    return null;
  }

  const planUsage = pickField(decoded, 'plan_usage', 'planUsage') as
    | Record<string, unknown>
    | undefined;
  const spendLimit = pickField(decoded, 'spend_limit_usage', 'spendLimitUsage') as
    | Record<string, unknown>
    | undefined;

  const info: BillingInfo = {
    billingCycleStart: isoFromTimestamp(
      pickField(decoded, 'billing_cycle_start', 'billingCycleStart')
    ),
    billingCycleEnd: isoFromTimestamp(
      pickField(decoded, 'billing_cycle_end', 'billingCycleEnd')
    ),
    planUsage: planUsage
      ? {
          slowRequests: asNumber(
            planUsage.slow_premium_requests_count ?? planUsage.slowPremiumRequestsCount
          ),
          fastRequests: asNumber(
            planUsage.fast_premium_requests_count ?? planUsage.fastPremiumRequestsCount
          ),
          limit: asNumber(
            planUsage.plan_request_count_limit ??
              planUsage.planRequestCountLimit ??
              planUsage.limit
          ),
        }
      : undefined,
    spendLimit: spendLimit
      ? {
          currentSpendUsd: centsToUsd(
            spendLimit.spend_usd_cents ??
              spendLimit.spendUsdCents ??
              spendLimit.totalSpend
          ),
          limitUsd: centsToUsd(
            spendLimit.spend_limit_usd_cents ?? spendLimit.spendLimitUsdCents
          ),
        }
      : undefined,
  };

  return hasBillingData(info) ? info : null;
}

/**
 * Extract token usage from streaming or metadata-bearing responses.
 */
export function extractTokenUsage(decoded: Record<string, unknown> | null | undefined): TokenUsageInfo | null {
  if (!decoded) {
    return null;
  }

  const metadata = (decoded.metadata ?? decoded.meta) as
    | Record<string, unknown>
    | undefined;
  const usage =
    (metadata?.token_usage as Record<string, unknown> | undefined) ??
    (metadata?.tokenUsage as Record<string, unknown> | undefined) ??
    (decoded.token_usage as Record<string, unknown> | undefined) ??
    (decoded.tokenUsage as Record<string, unknown> | undefined) ??
    (decoded.usage as Record<string, unknown> | undefined);

  const directInput = asNumber(
    decoded.input_tokens ?? decoded.inputTokens
  );
  const directOutput = asNumber(
    decoded.output_tokens ?? decoded.outputTokens
  );
  const directCacheRead = asNumber(
    decoded.cache_read_tokens ??
      decoded.cacheReadTokens ??
      decoded.cached_tokens ??
      decoded.cachedTokens
  );
  const directCacheWrite = asNumber(
    decoded.cache_write_tokens ?? decoded.cacheWriteTokens
  );
  const directTotal = asNumber(decoded.total_tokens ?? decoded.totalTokens);
  const directCents = asNumber(decoded.total_cents ?? decoded.totalCents);
  if (
    directInput != null ||
    directOutput != null ||
    directCacheRead != null ||
    directCacheWrite != null ||
    directTotal != null ||
    directCents != null
  ) {
    return {
      promptTokens: directInput,
      completionTokens: directOutput,
      cachedTokens: directCacheRead,
      cacheReadTokens: directCacheRead,
      cacheWriteTokens: directCacheWrite,
      totalTokens:
        directTotal ??
        (directInput != null && directOutput != null
          ? directInput + directOutput
          : undefined),
      totalCents: directCents,
    };
  }

  if (!usage) {
    return null;
  }

  return {
    modelName:
      (metadata?.model_name as string | undefined) ??
      (metadata?.modelName as string | undefined) ??
      (decoded.model_name as string | undefined) ??
      (decoded.modelName as string | undefined),
    promptTokens: asNumber(
      usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens ?? usage.inputTokens
    ),
    completionTokens: asNumber(
      usage.completion_tokens ??
        usage.completionTokens ??
        usage.output_tokens ??
        usage.outputTokens
    ),
    totalTokens: asNumber(usage.total_tokens ?? usage.totalTokens),
    cachedTokens: asNumber(
      usage.cached_tokens ??
        usage.cachedTokens ??
        usage.cache_read_tokens ??
        usage.cacheReadTokens
    ),
    cacheReadTokens: asNumber(
      usage.cache_read_tokens ??
        usage.cacheReadTokens ??
        usage.cached_tokens ??
        usage.cachedTokens
    ),
    cacheWriteTokens: asNumber(
      usage.cache_write_tokens ?? usage.cacheWriteTokens
    ),
    totalCents: asNumber(usage.total_cents ?? usage.totalCents),
  };
}

/**
 * Extract conversation context from composer/chat requests.
 */
export function extractConversationContext(
  decoded: Record<string, unknown> | null | undefined
): ConversationContext | null {
  if (!decoded) {
    return null;
  }

  const messages = decoded.conversation_messages ?? decoded.conversationMessages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  const files = new Set<string>();
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') {
      continue;
    }
    const userContext = (msg as Record<string, unknown>).user_context as
      | Record<string, unknown>
      | undefined;
    const fileList = userContext?.files;
    if (Array.isArray(fileList)) {
      for (const file of fileList) {
        if (file && typeof file === 'object') {
          const path = (file as Record<string, unknown>).path;
          if (typeof path === 'string') {
            files.add(path);
          }
        }
      }
    }
  }

  return {
    conversationId:
      (decoded.conversation_id as string | undefined) ??
      (decoded.conversationId as string | undefined),
    messageCount: messages.length,
    totalContextTokens: asNumber(decoded.total_context_tokens),
    includedFiles: files.size > 0 ? [...files] : undefined,
  };
}

const SENSITIVE_FIELD_RE =
  /^(authorization|token|api[_-]?key|secret|password|cookie|refresh[_-]?token|access[_-]?token)$/i;

/**
 * Redact sensitive fields from decoded protobuf objects before display/logging.
 */
export function redactSensitive(obj: unknown, depth = 0): unknown {
  if (depth > 12 || obj == null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitive(item, depth + 1));
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  const record = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_FIELD_RE.test(key)) {
      out[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      out[key] = redactSensitive(value, depth + 1);
    } else {
      out[key] = value;
    }
  }

  return out;
}

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
    const n = Number((value).length);
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

/**
 * Extract usage from nested AgentServerMessage / AgentClientMessage (Bidi `data`).
 */
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

function extractWorkspaceInfo(
  decoded: Record<string, unknown>
): ProxyInsights['workspace'] | null {
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

/**
 * Extract model and session fields from AgentClientMessage.runRequest.
 */
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

/**
 * Extract conversation and subagent linkage from nested Agent bidi messages.
 */
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

export function mergeAgentSessionInfo(
  base: AgentSessionInfo | undefined,
  extra: AgentSessionInfo | undefined
): AgentSessionInfo | undefined {
  if (!base && !extra) {
    return undefined;
  }
  const merged: AgentSessionInfo = { ...(base ?? {}) };
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
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

/**
 * Extract Agent bidi session fields from BidiAppend / BidiPoll / RunPoll payloads.
 */
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

function isAgentInteractiveRpc(rpcPath: string): boolean {
  return (
    rpcPath.includes('RunPoll') ||
    rpcPath.includes('RunSSE') ||
    rpcPath.includes('AgentService/Run') ||
    rpcPath.includes('BidiAppend') ||
    rpcPath.includes('BidiPoll') ||
    rpcPath.includes('StreamBidi')
  );
}

/**
 * Pick insights based on RPC path.
 */
export function extractInsightsForRpc(
  rpcPath: string,
  decoded: Record<string, unknown>
): ProxyInsights | undefined {
  const insights: ProxyInsights = {};

  if (rpcPath.includes('GetCurrentPeriodUsage') || rpcPath.includes('GetPlanInfo')) {
    insights.billing = extractBillingInfo(decoded) ?? undefined;
  }

  if (
    rpcPath.includes('StreamComposer') ||
    rpcPath.includes('StreamChat') ||
    rpcPath.includes('GetTokenUsage')
  ) {
    insights.tokens = extractTokenUsage(decoded) ?? undefined;
  }

  if (
    rpcPath.includes('StreamComposer') ||
    rpcPath.includes('StreamChat') ||
    rpcPath.includes('Conversation')
  ) {
    insights.context = extractConversationContext(decoded) ?? undefined;
  }

  if (isAgentInteractiveRpc(rpcPath)) {
    insights.agent = extractAgentSessionInfo(decoded) ?? undefined;
    insights.workspace = extractWorkspaceInfo(decoded) ?? undefined;
  }

  const usageUuid =
    (typeof decoded.usage_uuid === 'string' && decoded.usage_uuid) ||
    (typeof decoded.usageUuid === 'string' && decoded.usageUuid) ||
    undefined;
  if (usageUuid) {
    insights.agent = mergeAgentSessionInfo(insights.agent, {
      usageUuid,
      usageEvent: 'usage_uuid',
    });
  }

  if (!insights.billing && !insights.tokens && !insights.context && !insights.agent && !insights.workspace) {
    return undefined;
  }

  return insights;
}
