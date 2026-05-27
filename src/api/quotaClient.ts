import { TokenService } from '../auth/tokenRefresh';
import {
  GetCurrentPeriodUsageResponse,
  PlanUsageRaw,
  QuotaUsage,
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
  };
}

export function mapUsageResponse(
  response: GetCurrentPeriodUsageResponse,
  accountEmail?: string
): QuotaUsage {
  const usage = normalizePlanUsage(response.planUsage);
  usage.billingCycleStart = response.billingCycleStart ?? '';
  usage.billingCycleEnd = response.billingCycleEnd ?? '';
  usage.displayMessage = response.displayMessage;
  usage.accountEmail = accountEmail;
  return usage;
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
  constructor(private readonly tokenService: TokenService) {}

  async getUsage(signal?: AbortSignal): Promise<QuotaUsage> {
    const tokens = await this.tokenService.getValidTokens(signal);

    try {
      const raw = await fetchCurrentPeriodUsage(tokens.accessToken, signal);
      return mapUsageResponse(raw, tokens.email);
    } catch (error) {
      if (
        error instanceof QuotaApiError &&
        error.statusCode === 401 &&
        tokens.refreshToken
      ) {
        const refreshed = await this.tokenService.refreshTokens(
          tokens.refreshToken,
          signal
        );
        const raw = await fetchCurrentPeriodUsage(
          refreshed.accessToken,
          signal
        );
        return mapUsageResponse(raw, tokens.email);
      }
      throw error;
    }
  }
}
