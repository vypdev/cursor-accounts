import { buildWorkosSessionCookie } from '../auth/sessionCookie';
import type {
  QuotaUsage,
  UsageSummaryResponse,
  UsageSummarySpendBucketRaw,
} from './types';

const USAGE_SUMMARY_ENDPOINT = 'https://cursor.com/api/usage-summary';

export class UsageSummaryApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = 'UsageSummaryApiError';
  }
}

export async function fetchUsageSummary(
  accessToken: string,
  signal?: AbortSignal
): Promise<UsageSummaryResponse> {
  const cookie = buildWorkosSessionCookie(accessToken);

  const response = await fetch(USAGE_SUMMARY_ENDPOINT, {
    method: 'GET',
    headers: {
      Cookie: cookie,
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new UsageSummaryApiError(
      text || `Usage summary API returned ${response.status}`,
      response.status
    );
  }

  return (await response.json()) as UsageSummaryResponse;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function computeMonthlyPercent(
  used: number,
  limit: number | null | undefined
): number {
  if (limit == null || limit <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

function bucketHasSpendData(bucket: UsageSummarySpendBucketRaw): boolean {
  const used = toFiniteNumber(bucket.used) ?? 0;
  const limit =
    bucket.limit != null ? (toFiniteNumber(bucket.limit) ?? null) : null;
  const remaining = toFiniteNumber(bucket.remaining);
  return used > 0 || limit != null || remaining != null;
}

function resolveBucketFields(
  bucket: UsageSummarySpendBucketRaw
): {
  monthlySpend: number;
  monthlyLimit: number | null;
  monthlyRemaining: number;
} {
  const monthlySpend = toFiniteNumber(bucket.used) ?? 0;
  let monthlyLimit =
    bucket.limit != null ? (toFiniteNumber(bucket.limit) ?? null) : null;
  let monthlyRemaining = toFiniteNumber(bucket.remaining);

  if (monthlyLimit == null && monthlySpend > 0 && monthlyRemaining != null) {
    monthlyLimit = monthlySpend + monthlyRemaining;
  }

  if (monthlyRemaining == null && monthlyLimit != null) {
    monthlyRemaining = Math.max(0, monthlyLimit - monthlySpend);
  }

  return {
    monthlySpend,
    monthlyLimit,
    monthlyRemaining: monthlyRemaining ?? 0,
  };
}

function resolveMonthlySpendFields(
  overall: UsageSummarySpendBucketRaw,
  onDemand: UsageSummarySpendBucketRaw,
  teamOnDemand: UsageSummarySpendBucketRaw
): {
  monthlySpend: number;
  monthlyLimit: number | null;
  monthlyRemaining: number;
} {
  if (bucketHasSpendData(overall)) {
    return resolveBucketFields(overall);
  }

  if (bucketHasSpendData(onDemand)) {
    return resolveBucketFields(onDemand);
  }

  if (bucketHasSpendData(teamOnDemand)) {
    return resolveBucketFields(teamOnDemand);
  }

  return { monthlySpend: 0, monthlyLimit: null, monthlyRemaining: 0 };
}

export function mapUsageSummaryResponse(
  response: UsageSummaryResponse,
  accountEmail?: string
): QuotaUsage {
  const plan = response.individualUsage?.plan ?? {};
  const overall = response.individualUsage?.overall ?? {};
  const onDemand = response.individualUsage?.onDemand ?? {};
  const teamOnDemand = response.teamUsage?.onDemand ?? {};
  const teamPooled = response.teamUsage?.pooled ?? {};
  const isEnterprise = isEnterpriseOrTeamSummary(response);

  const { monthlySpend, monthlyLimit, monthlyRemaining } =
    resolveMonthlySpendFields(overall, onDemand, teamOnDemand);

  const hasIndividualSpend = monthlySpend > 0 || monthlyLimit != null;
  const useMonthlySpend = isEnterprise || hasIndividualSpend;

  const totalPercentUsed = useMonthlySpend
    ? computeMonthlyPercent(monthlySpend, monthlyLimit)
    : (plan.totalPercentUsed ?? 0);

  const displayMessage =
    response.namedModelSelectedDisplayMessage ??
    response.autoModelSelectedDisplayMessage;

  return {
    totalPercentUsed,
    autoPercentUsed: plan.autoPercentUsed ?? 0,
    apiPercentUsed: plan.apiPercentUsed ?? 0,
    totalSpend: monthlySpend,
    includedSpend: plan.used ?? 0,
    remaining: monthlyRemaining,
    limit: monthlyLimit ?? plan.limit ?? 0,
    billingCycleStart: response.billingCycleStart ?? '',
    billingCycleEnd: response.billingCycleEnd ?? '',
    displayMessage,
    accountEmail,
    fetchedAt: Date.now(),
    membershipType: response.membershipType,
    limitType: response.limitType,
    displayMode: useMonthlySpend ? 'monthlySpend' : 'percent',
    monthlySpend,
    monthlyLimit,
    teamMonthlySpend: toFiniteNumber(teamPooled.used),
    teamMonthlyLimit:
      teamPooled.limit != null ? (toFiniteNumber(teamPooled.limit) ?? null) : null,
    dataSource: 'web',
  };
}

export function isEnterpriseOrTeamSummary(
  response: UsageSummaryResponse
): boolean {
  return (
    response.membershipType === 'enterprise' ||
    response.limitType === 'team'
  );
}
