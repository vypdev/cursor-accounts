export interface TokenUsageInfo {
  modelName?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
}

export interface BillingInfo {
  billingCycleStart?: string;
  billingCycleEnd?: string;
  planUsage?: {
    slowRequests?: number;
    fastRequests?: number;
    limit?: number;
  };
  spendLimit?: {
    currentSpendUsd?: number;
    limitUsd?: number;
  };
}

export interface ConversationContext {
  conversationId?: string;
  messageCount?: number;
  totalContextTokens?: number;
  includedFiles?: string[];
}

export interface ProxyInsights {
  billing?: BillingInfo;
  tokens?: TokenUsageInfo;
  context?: ConversationContext;
}

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
    cachedTokens: asNumber(usage.cached_tokens ?? usage.cachedTokens),
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

  if (!insights.billing && !insights.tokens && !insights.context) {
    return undefined;
  }

  return insights;
}
