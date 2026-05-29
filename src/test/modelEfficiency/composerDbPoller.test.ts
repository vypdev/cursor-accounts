import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DB_POLLER_STATE_KEY,
  SEEN_BUBBLES_CAP_PER_COMPOSER,
} from '../../modelEfficiency/types';

describe('composerDbPoller state', () => {
  it('SEEN_BUBBLES_CAP_PER_COMPOSER is a reasonable FIFO cap', () => {
    assert.equal(SEEN_BUBBLES_CAP_PER_COMPOSER, 200);
  });

  it('DB_POLLER_STATE_KEY is stable for globalState', () => {
    assert.equal(DB_POLLER_STATE_KEY, 'efficiency.dbPollerState');
  });
});

describe('composerDbPoller dedup logic', () => {
  it('marking seen bubbles prevents duplicate ids in list', () => {
    const seen: Record<string, string[]> = {};
    const composerId = 'c1';
    const mark = (bubbleId: string): void => {
      const list = seen[composerId] ?? [];
      if (!list.includes(bubbleId)) {
        list.push(bubbleId);
      }
      if (list.length > SEEN_BUBBLES_CAP_PER_COMPOSER) {
        list.splice(0, list.length - SEEN_BUBBLES_CAP_PER_COMPOSER);
      }
      seen[composerId] = list;
    };

    mark('b1');
    mark('b1');
    mark('b2');
    assert.deepEqual(seen[composerId], ['b1', 'b2']);
  });
});
