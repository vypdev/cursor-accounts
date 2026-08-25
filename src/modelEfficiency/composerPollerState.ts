import type { DbPollerState } from './types';
import { SEEN_BUBBLES_CAP_PER_COMPOSER } from './types';

export function createEmptyPollerState(): DbPollerState {
  return {
    seenBubbleIds: {},
    lastUpdatedAtByComposer: {},
  };
}

export function markBubbleSeen(
  state: DbPollerState,
  composerId: string,
  bubbleId: string
): void {
  const list = state.seenBubbleIds[composerId] ?? [];
  if (list.includes(bubbleId)) {
    return;
  }

  list.push(bubbleId);
  if (list.length > SEEN_BUBBLES_CAP_PER_COMPOSER) {
    list.splice(0, list.length - SEEN_BUBBLES_CAP_PER_COMPOSER);
  }
  state.seenBubbleIds[composerId] = list;
}

export function isBubbleSeen(
  state: DbPollerState,
  composerId: string,
  bubbleId: string
): boolean {
  return (state.seenBubbleIds[composerId] ?? []).includes(bubbleId);
}
