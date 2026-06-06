import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseComposerWorkspaceData,
  toActiveConversationState,
} from '../../cursor/composerWorkspaceDataParse';

describe('parseComposerWorkspaceData', () => {
  it('parses lastFocusedComposerIds and selectedComposerIds', () => {
    const parsed = parseComposerWorkspaceData(
      JSON.stringify({
        selectedComposerIds: ['aaaa-bbbb'],
        lastFocusedComposerIds: ['cccc-dddd'],
      })
    );

    assert.ok(parsed);
    assert.deepEqual(parsed.selectedComposerIds, ['aaaa-bbbb']);
    assert.deepEqual(parsed.lastFocusedComposerIds, ['cccc-dddd']);
  });

  it('returns null for invalid JSON', () => {
    assert.equal(parseComposerWorkspaceData('{bad'), null);
    assert.equal(parseComposerWorkspaceData(null), null);
  });

  it('prefers lastFocusedComposerIds over selectedComposerIds', () => {
    const state = toActiveConversationState({
      selectedComposerIds: ['selected-id'],
      lastFocusedComposerIds: ['focused-id'],
    });

    assert.equal(state.lastFocusedComposerId, 'focused-id');
    assert.deepEqual(state.selectedComposerIds, ['selected-id']);
    assert.equal(state.sourceKey, 'composer.composerData');
  });

  it('falls back to selectedComposerIds when focus list is empty', () => {
    const state = toActiveConversationState({
      selectedComposerIds: ['selected-only'],
      lastFocusedComposerIds: [],
    });

    assert.equal(state.lastFocusedComposerId, 'selected-only');
  });
});
