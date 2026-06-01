import type { QuotaUsage } from '@cursor-accounts/types';
import { isEnterpriseUsage } from '@cursor-accounts/types';
import type {
  GetCurrentPeriodUsageResponse,
  PlanUsageRaw,
  SpendLimitUsageRaw,
} from '../../api/types';

function normalizePlanUsage(raw: PlanUsageRaw | undefined): QuotaUsage {
  const plan = raw ?? {};
  return {
    totalPercentUsed: plan.totalPercentUsed ?? 0,
    autoPercentUsed: plan.autoPercentUsed ?? 0,
    apiPercentUsed: plan.apiPercentUsed ?? 0,
    totalSpend: plan.totalSpend ?? 0,
    includedSpend: plan.includedSpend ?? 0,
    remaining: plan.remaining ?? 0,
    limit: plan.limit ?? 0,
    billingCycleStart: '',
    billingCycleEnd: '',
    fetchedAt: Date.now(),
    displayMode: 'percent',
    dataSource: 'ide',
  };
}

function applySpendLimitUsage(
  usage: QuotaUsage,
  spendLimit?: SpendLimitUsageRaw
): QuotaUsage {
  if (!spendLimit) {
    return usage;
  }

  const limitType = spendLimit.limitType;
  const individualUsed = spendLimit.individualUsed ?? 0;
  const individualLimit = spendLimit.individualLimit ?? null;
  const pooledUsed = spendLimit.pooledUsed ?? 0;
  const pooledLimit = spendLimit.pooledLimit ?? null;

  const hasIndividualSpend =
    individualLimit != null && individualLimit > 0 && individualUsed >= 0;
  const hasTeamSpend = pooledLimit != null && pooledLimit > 0 && pooledUsed >= 0;

  if (limitType === 'team' && hasTeamSpend && pooledLimit != null) {
    return {
      ...usage,
      limitType: 'team',
      displayMode: 'monthlySpend',
      monthlySpend: pooledUsed,
      monthlyLimit: pooledLimit,
      teamMonthlySpend: pooledUsed,
      teamMonthlyLimit: pooledLimit,
      totalSpend: pooledUsed,
      limit: pooledLimit ?? usage.limit,
      remaining: spendLimit.pooledRemaining ?? usage.remaining,
      totalPercentUsed: Math.min(
        100,
        Math.max(0, (pooledUsed / pooledLimit) * 100)
      ),
    };
  }

  if (hasIndividualSpend && individualLimit != null) {
    return {
      ...usage,
      limitType: limitType ?? 'user',
      displayMode: 'monthlySpend',
      monthlySpend: individualUsed,
      monthlyLimit: individualLimit,
      totalSpend: individualUsed,
      limit: individualLimit ?? usage.limit,
      remaining: spendLimit.individualRemaining ?? usage.remaining,
      totalPercentUsed: Math.min(
        100,
        Math.max(0, (individualUsed / individualLimit) * 100)
      ),
    };
  }

  return usage;
}

export function mapUsageResponse(
  response: GetCurrentPeriodUsageResponse,
  accountEmail?: string
): QuotaUsage {
  let usage = normalizePlanUsage(response.planUsage);
  usage.billingCycleStart = response.billingCycleStart ?? '';
  usage.billingCycleEnd = response.billingCycleEnd ?? '';
  usage.displayMessage =
    response.displayMessage ??
    response.namedModelSelectedDisplayMessage ??
    response.autoModelSelectedDisplayMessage;
  usage.accountEmail = accountEmail;
  usage = applySpendLimitUsage(usage, response.spendLimitUsage);
  return usage;
}

export function mergeWebUsage(
  ideUsage: QuotaUsage,
  webUsage: QuotaUsage
): QuotaUsage {
  if (isEnterpriseUsage(webUsage) || webUsage.displayMode === 'monthlySpend') {
    return {
      ...webUsage,
      autoPercentUsed: webUsage.autoPercentUsed || ideUsage.autoPercentUsed,
      apiPercentUsed: webUsage.apiPercentUsed || ideUsage.apiPercentUsed,
      displayMessage: webUsage.displayMessage ?? ideUsage.displayMessage,
      accountEmail: webUsage.accountEmail ?? ideUsage.accountEmail,
      billingCycleStart:
        webUsage.billingCycleStart || ideUsage.billingCycleStart,
      billingCycleEnd: webUsage.billingCycleEnd || ideUsage.billingCycleEnd,
    };
  }

  return {
    ...ideUsage,
    membershipType: webUsage.membershipType ?? ideUsage.membershipType,
    limitType: webUsage.limitType ?? ideUsage.limitType,
    billingCycleStart: webUsage.billingCycleStart || ideUsage.billingCycleStart,
    billingCycleEnd: webUsage.billingCycleEnd || ideUsage.billingCycleEnd,
    displayMessage: webUsage.displayMessage ?? ideUsage.displayMessage,
    dataSource: 'web',
  };
}

export function shouldFetchWebUsageSummary(ideUsage: QuotaUsage): boolean {
  if (ideUsage.displayMode === 'monthlySpend') {
    return false;
  }

  const emptyPlan =
    ideUsage.totalPercentUsed === 0 &&
    ideUsage.limit === 0 &&
    ideUsage.totalSpend === 0;

  if (!emptyPlan) {
    return false;
  }

  return true;
}
