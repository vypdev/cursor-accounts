import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  QuotaApiError,
  QuotaClient,
  fetchCurrentPeriodUsage,
} from '../api/quotaClient';
import type { IRefreshableTokenProvider, ITokenProvider } from '../domain/ports/ITokenProvider';
import type { CursorAuthTokens } from '@cursor-accounts/types';

class StaticRefreshableProvider implements IRefreshableTokenProvider {
  constructor(
    private tokens: CursorAuthTokens,
    private readonly refreshImpl?: () => Promise<CursorAuthTokens>
  ) {}

  async getValidTokens(): Promise<CursorAuthTokens> {
    return this.tokens;
  }

  async refreshTokens(): Promise<CursorAuthTokens> {
    if (this.refreshImpl) {
      this.tokens = await this.refreshImpl();
    }
    return this.tokens;
  }
}

describe('fetchCurrentPeriodUsage', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws QuotaApiError when API returns non-OK status', async () => {
    globalThis.fetch = mock.fn(async () =>
      Response.json({ error: 'unauthorized' }, { status: 401 })
    ) as typeof fetch;

    await assert.rejects(
      () => fetchCurrentPeriodUsage('token'),
      (error: unknown) => {
        assert.ok(error instanceof QuotaApiError);
        assert.equal(error.statusCode, 401);
        return true;
      }
    );
  });

  it('parses valid usage response JSON', async () => {
    globalThis.fetch = mock.fn(async () =>
      Response.json(
        {
          billingCycleStart: '1',
          billingCycleEnd: '2',
          planUsage: { totalPercentUsed: 42 },
        },
        { status: 200 }
      )
    ) as typeof fetch;

    const response = await fetchCurrentPeriodUsage('token');
    assert.equal(response.planUsage?.totalPercentUsed, 42);
  });
});

describe('QuotaClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('retries usage fetch after refreshable provider handles 401', async () => {
    let usageCalls = 0;
    globalThis.fetch = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('GetCurrentPeriodUsage')) {
        usageCalls += 1;
        if (usageCalls === 1) {
          return Response.json({ error: 'expired' }, { status: 401 });
        }
        return Response.json(
          {
            planUsage: { totalPercentUsed: 10, limit: 100 },
          },
          { status: 200 }
        );
      }
      return Response.json({}, { status: 404 });
    }) as typeof fetch;

    const provider = new StaticRefreshableProvider(
      { accessToken: 'old', refreshToken: 'refresh' },
      async () => ({ accessToken: 'new', refreshToken: 'refresh' })
    );
    const client = new QuotaClient(provider);
    const usage = await client.getUsage();

    assert.equal(usage.totalPercentUsed, 10);
    assert.equal(usageCalls, 2);
  });

  it('does not refresh when provider is not refreshable', async () => {
    globalThis.fetch = mock.fn(async () =>
      Response.json({ error: 'expired' }, { status: 401 })
    ) as typeof fetch;

    const provider: ITokenProvider = {
      getValidTokens: async () => ({
        accessToken: 'old',
        refreshToken: 'refresh',
      }),
    };
    const client = new QuotaClient(provider);

    await assert.rejects(() => client.getUsage(), QuotaApiError);
  });
});
