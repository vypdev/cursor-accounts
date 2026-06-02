import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getEfficiencyFillStatus,
  getEfficiencyPercentage,
} from '@cursor-accounts/types';

describe('efficiency stats helpers', () => {
  it('computes percentage from efficient/total counts', () => {
    assert.equal(
      getEfficiencyPercentage({ totalPrompts: 10, efficientPrompts: 7 }),
      70
    );
    assert.equal(getEfficiencyPercentage(undefined), 0);
  });

  it('maps percentage to fill status', () => {
    assert.equal(
      getEfficiencyFillStatus({ totalPrompts: 10, efficientPrompts: 8 }),
      'ok'
    );
    assert.equal(
      getEfficiencyFillStatus({ totalPrompts: 10, efficientPrompts: 6 }),
      'warning'
    );
    assert.equal(
      getEfficiencyFillStatus({ totalPrompts: 10, efficientPrompts: 3 }),
      'critical'
    );
  });
});
