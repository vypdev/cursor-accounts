import './registerVscodeMock.js';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { QuotaUsage } from '@cursor-accounts/types';
import { RefreshService } from '../services/refreshService';
import type { IQuotaService } from '../domain/ports/IQuotaService';

class FakeQuotaService implements IQuotaService {
  constructor(
    private readonly handler: () => Promise<QuotaUsage>,
    readonly calls: number[] = []
  ) {}

  async getUsage(): Promise<QuotaUsage> {
    this.calls.push(Date.now());
    return this.handler();
  }
}

describe('RefreshService', () => {
  beforeEach(() => {
    process.chdir(process.cwd());
  });

  afterEach(() => {
    // noop
  });

  it('invokes success callback when quota fetch succeeds', async () => {
    const usage: QuotaUsage = {
      totalPercentUsed: 10,
      autoPercentUsed: 5,
      apiPercentUsed: 15,
      totalSpend: 0,
      includedSpend: 0,
      remaining: 100,
      limit: 1000,
      billingCycleStart: '0',
      billingCycleEnd: '0',
      fetchedAt: Date.now(),
    };

    const quotaService = new FakeQuotaService(async () => usage);
    let rendered: QuotaUsage | undefined;

    const context = {
      subscriptions: [],
      globalState: {
        update: async () => undefined,
      },
    } as unknown as import('vscode').ExtensionContext;

    const service = new RefreshService(
      context,
      quotaService,
      (value) => {
        rendered = value;
      },
      () => undefined
    );

    await service.tickNow();
    assert.deepEqual(rendered, usage);
    assert.equal(quotaService.calls.length, 1);
  });

  it('applies exponential backoff after failures', async () => {
    let errorCount = 0;
    const quotaService = new FakeQuotaService(async () => {
      throw new Error('network down');
    });

    const context = {
      subscriptions: [],
      globalState: {
        update: async () => undefined,
      },
    } as unknown as import('vscode').ExtensionContext;

    const service = new RefreshService(
      context,
      quotaService,
      () => undefined,
      () => {
        errorCount += 1;
      }
    );

    await service.tickNow();
    await service.tickNow();

    assert.equal(errorCount, 2);
    assert.equal(quotaService.calls.length, 2);
  });
});
