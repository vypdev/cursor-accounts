import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile, ProfileQuota } from '@cursor-accounts/types';
import type { IProfileQuotaCache } from '../../domain/ports/IProfileQuotaCache';
import type { IProfileReader } from '../../domain/ports/IProfileReader';
import {
  ProfileQuotaRefreshUseCase,
  type ProfileQuotaFetchPort,
} from '../../application/services/profileQuotaRefreshUseCase';

function profile(id: string): Profile {
  return {
    id,
    email: `${id}@example.com`,
    slug: id,
    displayName: id,
    userDataDir: `/tmp/${id}`,
    created: '2026-01-01T00:00:00.000Z',
  };
}

function quota(profileId: string, fetchedAt = 1): ProfileQuota {
  return {
    profileId,
    quota: {
      totalPercentUsed: 10,
      autoPercentUsed: 10,
      apiPercentUsed: 10,
      totalSpend: 0,
      includedSpend: 0,
      remaining: 90,
      limit: 100,
      billingCycleStart: '2026-01-01',
      billingCycleEnd: '2026-02-01',
      fetchedAt,
    },
    fetchedAt,
  };
}

function createUseCase(
  profiles: Profile[],
  fetcher: ProfileQuotaFetchPort,
  cached = new Map<string, ProfileQuota>()
) {
  const saves: Map<string, ProfileQuota>[] = [];
  const logs: string[] = [];
  const cache: IProfileQuotaCache = {
    getQuota: (profileId) => cached.get(profileId),
    getAllQuotas: () => new Map(cached),
    saveQuotas: async (values) => {
      saves.push(new Map(values));
      for (const [profileId, value] of values) {
        cached.set(profileId, value);
      }
    },
    getLeaderboard: () => undefined,
    saveLeaderboard: async () => undefined,
    clear: async () => undefined,
  };
  const profileReader = {
    getProfiles: async () => profiles,
  } as unknown as IProfileReader;
  const useCase = new ProfileQuotaRefreshUseCase({
    cache,
    profileReader,
    fetcher,
    now: () => 42,
    logDebug: (message) => logs.push(message),
  });

  return { useCase, saves, logs, cached };
}

describe('ProfileQuotaRefreshUseCase', () => {
  it('returns an empty map without saving when no profiles exist', async () => {
    const fetcher: ProfileQuotaFetchPort = {
      fetch: async () => quota('unexpected'),
    };
    const setup = createUseCase([], fetcher);

    assert.deepEqual(await setup.useCase.fetchAllQuotas(), new Map());
    assert.equal(setup.saves.length, 0);
  });

  it('maps fulfilled and rejected profile fetches and caches the result', async () => {
    const fetcher: ProfileQuotaFetchPort = {
      fetch: async (current) => {
        if (current.id === 'failed') {
          throw new Error('quota unavailable');
        }
        return quota(current.id, 7);
      },
    };
    const setup = createUseCase([profile('ok'), profile('failed')], fetcher);

    const result = await setup.useCase.fetchAllQuotas();

    assert.equal(result.get('ok')?.fetchedAt, 7);
    assert.equal(result.get('failed')?.error, 'quota unavailable');
    assert.equal(result.get('failed')?.fetchedAt, 42);
    assert.equal(setup.saves.length, 1);
    assert.deepEqual(setup.cached, result);
  });

  it('returns cached data and does not fetch when already cancelled', async () => {
    let fetches = 0;
    const fetcher: ProfileQuotaFetchPort = {
      fetch: async () => {
        fetches += 1;
        return quota('profile');
      },
    };
    const cached = new Map([['profile', quota('profile', 10)]]);
    const setup = createUseCase([profile('profile')], fetcher, cached);
    const controller = new AbortController();
    controller.abort();

    const result = await setup.useCase.fetchAllQuotas(controller.signal);

    assert.deepEqual(result, cached);
    assert.equal(fetches, 0);
    assert.equal(setup.saves.length, 0);
  });

  it('returns cached data when cancellation occurs during profile fetches', async () => {
    let resolveFetch: (value: ProfileQuota) => void = () => undefined;
    const fetcher: ProfileQuotaFetchPort = {
      fetch: () =>
        new Promise<ProfileQuota>((resolve) => {
          resolveFetch = resolve;
        }),
    };
    const cached = new Map([['profile', quota('profile', 10)]]);
    const setup = createUseCase([profile('profile')], fetcher, cached);
    const controller = new AbortController();
    const refresh = setup.useCase.fetchAllQuotas(controller.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    resolveFetch(quota('profile', 20));

    assert.deepEqual(await refresh, cached);
    assert.equal(setup.saves.length, 0);
    assert.match(setup.logs[0] ?? '', /cancelled/);
  });

  it('delegates single-profile fetches with the original abort signal', async () => {
    const signal = new AbortController().signal;
    let receivedSignal: AbortSignal | undefined;
    const fetcher: ProfileQuotaFetchPort = {
      fetch: async (_profile, currentSignal) => {
        receivedSignal = currentSignal;
        return quota('profile');
      },
    };
    const setup = createUseCase([], fetcher);

    const result = await setup.useCase.fetch(profile('profile'), signal);

    assert.equal(result.profileId, 'profile');
    assert.equal(receivedSignal, signal);
  });
});
