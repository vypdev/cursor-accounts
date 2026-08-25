import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DB_POLLER_STATE_KEY,
  SEEN_BUBBLES_CAP_PER_COMPOSER,
} from '../../modelEfficiency/types';
import {
  createEmptyPollerState,
  isBubbleSeen,
  markBubbleSeen,
} from '../../modelEfficiency/composerPollerState';

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
    const state = createEmptyPollerState();
    markBubbleSeen(state, 'c1', 'b1');
    markBubbleSeen(state, 'c1', 'b1');
    markBubbleSeen(state, 'c1', 'b2');
    assert.deepEqual(state.seenBubbleIds.c1, ['b1', 'b2']);
    assert.equal(isBubbleSeen(state, 'c1', 'b1'), true);
    assert.equal(isBubbleSeen(state, 'c1', 'missing'), false);
  });

  it('keeps only the newest bubble ids when the FIFO cap is exceeded', () => {
    const state = createEmptyPollerState();
    for (let index = 0; index <= SEEN_BUBBLES_CAP_PER_COMPOSER; index += 1) {
      markBubbleSeen(state, 'c1', `b${index}`);
    }

    assert.equal(state.seenBubbleIds.c1?.length, SEEN_BUBBLES_CAP_PER_COMPOSER);
    assert.equal(state.seenBubbleIds.c1?.[0], 'b1');
    assert.equal(state.seenBubbleIds.c1?.at(-1), `b${SEEN_BUBBLES_CAP_PER_COMPOSER}`);
  });
});
