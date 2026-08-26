import type {
  BillingInfo,
  TokenUsageInfo,
} from '../../application/types/proxyInsights';
import { asNumber, pickField } from './fieldNormalization';

export type { BillingInfo, TokenUsageInfo } from '../../application/types/proxyInsights';

function centsToUsd(cents: unknown): number | undefined {
  const n = asNumber(cents);
  return n != null ? n / 100 : undefined;
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

/** Extract billing fields from GetCurrentPeriodUsageResponse-shaped objects. */
export function extractBillingInfo(
  decoded: Record<string, unknown> | null | undefined
): BillingInfo | null {
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

/** Extract token usage from streaming or metadata-bearing responses. */
export function extractTokenUsage(
  decoded: Record<string, unknown> | null | undefined
): TokenUsageInfo | null {
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

  const directInput = asNumber(decoded.input_tokens ?? decoded.inputTokens);
  const directOutput = asNumber(decoded.output_tokens ?? decoded.outputTokens);
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
