import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPromptMetadata } from '../../modelEfficiency/composerPromptMetadata';

const context = {
  composerId: 'composer-a',
  profileEmail: 'a@example.com',
  model: 'model-a',
  modelResolved: true,
  workspaceRoots: ['/workspace'],
  gitBranch: 'main',
  lastUpdated: 200,
  enabledAtMs: 100,
};

describe('buildPromptMetadata', () => {
  it('builds metadata from a current user bubble', () => {
    const metadata = buildPromptMetadata(
      { type: 1, text: '  Explain this function  ', createdAt: '1970-01-01T00:00:00.150Z' },
      context
    );

    assert.deepEqual(metadata, {
      timestamp: 150,
      prompt: 'Explain this function',
      model: 'model-a',
      modelResolved: true,
      attachments: [],
      conversationId: 'composer-a',
      workspaceRoots: ['/workspace'],
      gitBranch: 'main',
      userEmail: 'a@example.com',
    });
  });

  it('falls back to rich text and the composer watermark timestamp', () => {
    const metadata = buildPromptMetadata(
      {
        type: 1,
        richText: JSON.stringify({
          root: { children: [{ children: [{ text: 'Rich prompt' }] }] },
        }),
      },
      context
    );

    assert.equal(metadata?.prompt, 'Rich prompt');
    assert.equal(metadata?.timestamp, 200);
  });

  it('filters non-user, empty, and pre-enabled bubbles', () => {
    assert.equal(buildPromptMetadata({ type: 2, text: 'assistant' }, context), undefined);
    assert.equal(buildPromptMetadata({ type: 1, text: '   ' }, context), undefined);
    assert.equal(
      buildPromptMetadata(
        { type: 1, text: 'old', createdAt: '1970-01-01T00:00:00.050Z' },
        context
      ),
      undefined
    );
  });

  it('does not reject invalid timestamps and uses the watermark when needed', () => {
    const metadata = buildPromptMetadata(
      { type: 1, text: 'prompt', createdAt: 'not-a-date' },
      context
    );

    assert.equal(metadata?.timestamp, 200);
  });
});
