import type { ITokenProvider } from '../domain/ports/ITokenProvider';
import { isRefreshableTokenProvider } from '../domain/ports/ITokenProvider';
import type { IQuotaService } from '../domain/ports/IQuotaService';
import * as extensionLog from '../logging/extensionLog';
import { mapUsageResponse, mergeWebUsage } from './quotaMappers';
import { fetchUsageSummary, mapUsageSummaryResponse } from './usageSummaryClient';
import type { GetCurrentPeriodUsageResponse, QuotaUsage } from './types';
import {
  getCurrentPeriodUsageResponseSchema,
  parseJsonWithSchema,
} from '../validation/apiSchemas';

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

export { mapUsageResponse, mergeWebUsage } from './quotaMappers';

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

  return parseJsonWithSchema(
    getCurrentPeriodUsageResponseSchema,
    await response.json(),
    'GetCurrentPeriodUsage response'
  );
}

export class QuotaClient implements IQuotaService {
  constructor(private readonly tokenProvider: ITokenProvider) {}

  async getUsage(signal?: AbortSignal): Promise<QuotaUsage> {
    const tokens = await this.tokenProvider.getValidTokens(signal);

    try {
      return await this.fetchUsageWithAccessToken(tokens.accessToken, tokens.email, signal);
    } catch (error) {
      if (
        error instanceof QuotaApiError &&
        error.statusCode === 401 &&
        tokens.refreshToken &&
        isRefreshableTokenProvider(this.tokenProvider)
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
      if (error instanceof QuotaApiError && error.statusCode === 401) {
        throw error;
      }
      extensionLog.debug(
        `[QuotaClient] IDE usage fetch failed, will try web summary: ${extensionLog.formatError(error)}`
      );
    }

    try {
      const summaryRaw = await fetchUsageSummary(accessToken, signal);
      const webMapped = mapUsageSummaryResponse(summaryRaw, accountEmail);
      if (ideUsage) {
        return mergeWebUsage(ideUsage, webMapped);
      }
      return webMapped;
    } catch (error) {
      extensionLog.debug(
        `[QuotaClient] Web usage summary fetch failed: ${extensionLog.formatError(error)}`
      );
    }

    if (ideUsage) {
      return ideUsage;
    }

    throw new QuotaApiError('Failed to fetch usage from IDE and web APIs');
  }
}
