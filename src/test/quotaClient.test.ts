import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapUsageResponse } from '../api/quotaClient';

describe('mapUsageResponse', () => {
  it('maps plan usage and billing cycle from API shape', () => {
    const usage = mapUsageResponse(
      {
        billingCycleStart: '1768399334000',
        billingCycleEnd: '1771077734000',
        planUsage: {
          totalSpend: 23222,
          includedSpend: 23222,
          remaining: 16778,
          limit: 40000,
          autoPercentUsed: 0,
          apiPercentUsed: 46.444,
          totalPercentUsed: 15.48,
        },
        displayMessage: "You've used 46% of your usage limit",
      },
      'user@example.com'
    );

    assert.equal(usage.apiPercentUsed, 46.444);
    assert.equal(usage.totalPercentUsed, 15.48);
    assert.equal(usage.limit, 40000);
    assert.equal(usage.billingCycleStart, '1768399334000');
    assert.equal(usage.accountEmail, 'user@example.com');
    assert.equal(usage.displayMessage, "You've used 46% of your usage limit");
    assert.ok(usage.fetchedAt > 0);
  });

  it('defaults missing planUsage fields to zero', () => {
    const usage = mapUsageResponse({});
    assert.equal(usage.totalPercentUsed, 0);
    assert.equal(usage.autoPercentUsed, 0);
    assert.equal(usage.apiPercentUsed, 0);
  });
});
