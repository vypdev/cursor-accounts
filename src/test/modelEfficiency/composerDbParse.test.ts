import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractPlainTextFromRichText,
  getUserBubbleHeaders,
  parseComposerHeaders,
  parseBubbleRow,
  USER_BUBBLE_TYPE,
} from '../../modelEfficiency/composerDbParse';
import { first, required } from '../testUtils';

describe('composerDbParse', () => {
  it('parseComposerHeaders reads allComposers', () => {
    const payload = parseComposerHeaders(
      JSON.stringify({
        allComposers: [{ composerId: 'abc', lastUpdatedAt: 42 }],
      })
    );
    const composer = first(required(payload?.allComposers, 'allComposers'));
    assert.equal(composer.composerId, 'abc');
    assert.equal(composer.lastUpdatedAt, 42);
  });

  it('getUserBubbleHeaders filters type 1 only', () => {
    const headers = getUserBubbleHeaders({
      fullConversationHeadersOnly: [
        { bubbleId: 'u1', type: USER_BUBBLE_TYPE },
        { bubbleId: 'a1', type: 2 },
      ],
    });
    assert.equal(headers.length, 1);
    assert.equal(first(headers).bubbleId, 'u1');
  });

  it('parseBubbleRow extracts user text', () => {
    const bubble = parseBubbleRow(
      JSON.stringify({ type: 1, text: 'Hola', createdAt: '2026-05-29T00:00:00Z' })
    );
    assert.equal(bubble?.text, 'Hola');
  });

  it('extractPlainTextFromRichText walks Lexical JSON', () => {
    const richText = JSON.stringify({
      root: {
        children: [
          {
            children: [{ text: 'Capital de ', type: 'text' }],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    });
    assert.equal(extractPlainTextFromRichText(richText), 'Capital de');
  });
});
