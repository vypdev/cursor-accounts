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

  it('uses the status fallback when the error response has no readable body', async () => {
    globalThis.fetch = mock.fn(async () =>
      new Response('', { status: 503 })
    ) as typeof fetch;

    await assert.rejects(
      () => fetchCurrentPeriodUsage('token'),
      (error: unknown) => {
        assert.ok(error instanceof QuotaApiError);
        assert.equal(error.message, 'Usage API returned 503');
        assert.equal(error.statusCode, 503);
        return true;
      }
    );
  });

  it('keeps the status fallback when the error response body cannot be read', async () => {
    globalThis.fetch = mock.fn(async () =>
      ({
        ok: false,
        status: 502,
        text: async () => {
          throw new Error('body unavailable');
        },
      }) as unknown as Response
    ) as typeof fetch;

    await assert.rejects(
      () => fetchCurrentPeriodUsage('token'),
      (error: unknown) => {
        assert.ok(error instanceof QuotaApiError);
        assert.equal(error.message, 'Usage API returned 502');
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

  it('falls back to the web summary when the IDE usage source fails', async () => {
    const accessToken = makeJwt({ sub: 'user_web_fallback' });
    globalThis.fetch = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('GetCurrentPeriodUsage')) {
        throw new Error('IDE source unavailable');
      }
      return Response.json(
        {
          membershipType: 'pro',
          individualUsage: {
            plan: { totalPercentUsed: 42 },
          },
        },
        { status: 200 }
      );
    }) as typeof fetch;

    const provider: ITokenProvider = {
      getValidTokens: async () => ({
        accessToken,
        email: 'web@example.com',
      }),
    };

    const usage = await new QuotaClient(provider).getUsage();

    assert.equal(usage.totalPercentUsed, 42);
    assert.equal(usage.dataSource, 'web');
  });

  it('returns IDE usage when the optional web summary source fails', async () => {
    const accessToken = makeJwt({ sub: 'user_ide_preferred' });
    globalThis.fetch = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('GetCurrentPeriodUsage')) {
        return Response.json(
          { planUsage: { totalPercentUsed: 17, limit: 100 } },
          { status: 200 }
        );
      }
      return Response.json({ error: 'web unavailable' }, { status: 503 });
    }) as typeof fetch;

    const provider: ITokenProvider = {
      getValidTokens: async () => ({ accessToken }),
    };

    const usage = await new QuotaClient(provider).getUsage();

    assert.equal(usage.totalPercentUsed, 17);
    assert.equal(usage.dataSource, 'ide');
  });

  it('merges IDE usage with the successful web summary source', async () => {
    const accessToken = makeJwt({ sub: 'user_merged_usage' });
    globalThis.fetch = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('GetCurrentPeriodUsage')) {
        return Response.json(
          {
            billingCycleEnd: '2026-08-31T00:00:00.000Z',
            planUsage: { totalPercentUsed: 17, limit: 100 },
          },
          { status: 200 }
        );
      }
      return Response.json(
        {
          billingCycleEnd: '2026-09-01T00:00:00.000Z',
          membershipType: 'pro',
          individualUsage: {
            plan: { totalPercentUsed: 42 },
          },
        },
        { status: 200 }
      );
    }) as typeof fetch;

    const provider: ITokenProvider = {
      getValidTokens: async () => ({ accessToken }),
    };

    const usage = await new QuotaClient(provider).getUsage();

    assert.equal(usage.totalPercentUsed, 17);
    assert.equal(usage.membershipType, 'pro');
    assert.equal(usage.dataSource, 'web');
    assert.equal(usage.billingCycleEnd, '2026-09-01T00:00:00.000Z');
  });

  it('reports a normalized error when both usage sources fail', async () => {
    const accessToken = makeJwt({ sub: 'user_no_usage' });
    globalThis.fetch = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('GetCurrentPeriodUsage')) {
        throw new Error('IDE source unavailable');
      }
      return Response.json({ error: 'web unavailable' }, { status: 503 });
    }) as typeof fetch;

    const provider: ITokenProvider = {
      getValidTokens: async () => ({ accessToken }),
    };

    await assert.rejects(
      () => new QuotaClient(provider).getUsage(),
      (error: unknown) => {
        assert.ok(error instanceof QuotaApiError);
        assert.equal(
          error.message,
          'Failed to fetch usage from IDE and web APIs'
        );
        return true;
      }
    );
  });
});

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString(
    'base64url'
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}
