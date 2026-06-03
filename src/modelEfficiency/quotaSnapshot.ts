import { getEffectiveUsagePercent, isEnterpriseUsage } from '@cursor-accounts/types';
import type { ProfileQuota } from '../profiles/types';

export function parseBillingCycleEpoch(
  value: string | undefined
): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const trimmed = value.trim();
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return asNumber > 1e12
      ? Math.floor(asNumber / 1000)
      : Math.floor(asNumber);
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.floor(parsed / 1000);
}

export function buildQuotaFieldsFromProfileQuota(
  quota: ProfileQuota | undefined
): {
  quotaPercentUsed?: number;
  quotaLimit?: number;
  quotaRemaining?: number;
  quotaCycleStart?: number;
  quotaCycleEnd?: number;
  quotaIsEnterprise?: boolean;
} {
  const usage = quota?.quota;
  if (!usage) {
    return {};
  }

  return {
    quotaPercentUsed: getEffectiveUsagePercent(usage),
    quotaLimit: usage.limit,
    quotaRemaining: usage.remaining,
    quotaCycleStart: parseBillingCycleEpoch(usage.billingCycleStart),
    quotaCycleEnd: parseBillingCycleEpoch(usage.billingCycleEnd),
    quotaIsEnterprise: isEnterpriseUsage(usage),
  };
}
