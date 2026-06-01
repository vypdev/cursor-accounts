import type { QuotaStatus, QuotaUsage } from '../entities/QuotaUsage';

/** Whether quota data represents an enterprise or team account. */
export function isEnterpriseUsage(quota: QuotaUsage | null | undefined): boolean {
  if (!quota) {
    return false;
  }
  return quota.membershipType === 'enterprise' || quota.limitType === 'team';
}

/** Average of API mode and auto mode usage for personal percent-mode accounts. */
export function getPersonalModeAveragePercent(quota: QuotaUsage | null): number {
  if (!quota) {
    return 0;
  }
  const average = (quota.apiPercentUsed + quota.autoPercentUsed) / 2;
  if (!Number.isFinite(average)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(average)));
}

/** Effective usage percent for progress bars and status thresholds. */
export function getEffectiveUsagePercent(quota: QuotaUsage | null): number {
  if (!quota) {
    return 0;
  }

  if (quota.displayMode === 'monthlySpend') {
    const spend = quota.monthlySpend ?? 0;
    const limit = quota.monthlyLimit;
    if (limit != null && limit > 0) {
      return Math.min(100, Math.max(0, (spend / limit) * 100));
    }
    return 0;
  }

  return quota.totalPercentUsed;
}

function getQuotaThresholdPercent(quota: QuotaUsage): number {
  if (!isEnterpriseUsage(quota) && quota.displayMode !== 'monthlySpend') {
    return getPersonalModeAveragePercent(quota);
  }
  return getEffectiveUsagePercent(quota);
}

/** Determine quota status from usage data. */
export function getQuotaStatus(quota: QuotaUsage | null): QuotaStatus {
  if (!quota) {
    return 'unavailable';
  }

  const percent = getQuotaThresholdPercent(quota);

  if (percent >= 95) {
    return 'critical';
  }
  if (percent >= 85) {
    return 'warning';
  }
  return 'ok';
}

function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) {
    return '$0.00';
  }
  return `$${(cents / 100).toFixed(2)}`;
}

/** Compact number for leaderboard metrics (e.g. 456728 → 457k). */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return String(Math.round(value));
}

/** Format monthly spend for profile card display. */
export function formatMonthlySpendLabel(quota: QuotaUsage): string {
  const spend = quota.monthlySpend ?? quota.totalSpend ?? 0;
  const limit = quota.monthlyLimit;
  if (limit == null) {
    return `${formatCents(spend)} / unlimited`;
  }
  return `${formatCents(spend)} / ${formatCents(limit)}`;
}

/** Format enterprise usage as percent + spend (e.g. "16% · $94.00/$600.00"). */
export function formatEnterpriseUsageLabel(quota: QuotaUsage): string {
  const percent = Math.round(getEffectiveUsagePercent(quota));
  return `${percent}% · ${formatMonthlySpendLabel(quota)}`;
}

export function getTeamUsagePercent(quota: QuotaUsage): number {
  const spend = quota.teamMonthlySpend ?? 0;
  const limit = quota.teamMonthlyLimit;
  if (limit != null && limit > 0) {
    return Math.min(100, Math.max(0, (spend / limit) * 100));
  }
  return 0;
}

/** Format team pooled spend for profile card display. */
export function formatTeamMonthlySpendLabel(quota: QuotaUsage): string {
  const spend = quota.teamMonthlySpend ?? 0;
  const limit = quota.teamMonthlyLimit;
  if (limit == null) {
    return `${formatCents(spend)} / unlimited`;
  }
  return `${formatCents(spend)} / ${formatCents(limit)}`;
}

/** Format team budget as percent + spend (e.g. "24% · $1,200.00/$5,000.00"). */
export function formatTeamBudgetLabel(quota: QuotaUsage): string {
  const percent = Math.round(getTeamUsagePercent(quota));
  return `${percent}% · ${formatTeamMonthlySpendLabel(quota)}`;
}

/** True when team pool data exists and differs from individual monthly spend. */
export function hasDistinctTeamBudget(quota: QuotaUsage): boolean {
  if (quota.teamMonthlySpend == null) {
    return false;
  }
  return (
    quota.teamMonthlySpend !== quota.monthlySpend ||
    quota.teamMonthlyLimit !== quota.monthlyLimit
  );
}
