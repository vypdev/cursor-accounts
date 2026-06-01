import type { QuotaUsage } from '@cursor-accounts/types';

/** Port for fetching normalized quota usage. */
export interface IQuotaService {
  getUsage(signal?: AbortSignal): Promise<QuotaUsage>;
}
