import { TokenProvider } from '../auth/tokenProvider';
import { TokenService } from '../auth/tokenRefresh';
import * as extensionLog from '../logging/extensionLog';
import {
  fetchUsageSummary,
  isEnterpriseOrTeamSummary,
  mapUsageSummaryResponse,
} from './usageSummaryClient';
import {
  GetCurrentPeriodUsageResponse,
  isEnterpriseUsage,
  PlanUsageRaw,
  QuotaUsage,
  SpendLimitUsageRaw,
} from './types';

const USAGE_ENDPOINT =
  'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';

export class QuotaApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = 'QuotaApiError';
  }
}

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

  if (limitType === 'team' && hasTeamSpend) {
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
        Math.max(0, (pooledUsed / pooledLimit!) * 100)
      ),
    };
  }

  if (hasIndividualSpend) {
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
        Math.max(0, (individualUsed / individualLimit!) * 100)
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

function shouldFetchWebUsageSummary(ideUsage: QuotaUsage): boolean {
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

  // IDE may return billing cycle dates but zero spend (typical enterprise case).
  return true;
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

export async function fetchCurrentPeriodUsage(
  accessToken: string,
  signal?: AbortSignal
): Promise<GetCurrentPeriodUsageResponse> {
  const response = await fetch(USAGE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
    },
    body: '{}',
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new QuotaApiError(
      text || `Usage API returned ${response.status}`,
      response.status
    );
  }

  return (await response.json()) as GetCurrentPeriodUsageResponse;
}

export class QuotaClient {
  constructor(private readonly tokenProvider: TokenProvider) {}

  async getUsage(signal?: AbortSignal): Promise<QuotaUsage> {
    const tokens = await this.tokenProvider.getValidTokens(signal);

    try {
      return await this.fetchUsageWithAccessToken(tokens.accessToken, tokens.email, signal);
    } catch (error) {
      if (
        error instanceof QuotaApiError &&
        error.statusCode === 401 &&
        tokens.refreshToken &&
        this.tokenProvider instanceof TokenService
      ) {
        extensionLog.debug(
          '[QuotaClient] Usage API returned 401; retrying after token refresh'
        );
        const refreshed = await this.tokenProvider.refreshTokens(
          tokens.refreshToken,
          undefined,
          signal
        );
        return this.fetchUsageWithAccessToken(
          refreshed.accessToken,
          tokens.email,
          signal
        );
      }
      if (error instanceof QuotaApiError) {
        extensionLog.warn(
          `[QuotaClient] Usage API error (status ${error.statusCode ?? 'unknown'}): ${error.message}`
        );
      }
      throw error;
    }
  }

  private async fetchUsageWithAccessToken(
    accessToken: string,
    accountEmail: string | undefined,
    signal?: AbortSignal
  ): Promise<QuotaUsage> {
    let ideUsage: QuotaUsage | undefined;

    try {
      const raw = await fetchCurrentPeriodUsage(accessToken, signal);
      ideUsage = mapUsageResponse(raw, accountEmail);
    } catch (error) {
      extensionLog.debug(
        `[QuotaClient] IDE usage fetch failed, will try web summary: ${error instanceof Error ? error.message : error}`
      );
    }

    let webSummary: QuotaUsage | undefined;
    try {
      const summaryRaw = await fetchUsageSummary(accessToken, signal);
      if (
        isEnterpriseOrTeamSummary(summaryRaw) ||
        !ideUsage ||
        shouldFetchWebUsageSummary(ideUsage)
      ) {
        webSummary = mapUsageSummaryResponse(summaryRaw, accountEmail);
      }
    } catch (error) {
      extensionLog.debug(
        `[QuotaClient] Web usage summary fetch failed: ${error instanceof Error ? error.message : error}`
      );
    }

    if (webSummary) {
      return ideUsage ? mergeWebUsage(ideUsage, webSummary) : webSummary;
    }

    if (ideUsage) {
      return ideUsage;
    }

    throw new QuotaApiError('Failed to fetch usage from IDE and web APIs');
  }
}
