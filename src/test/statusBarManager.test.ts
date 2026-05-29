import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appendProfileSuffix } from '../utils/statusBarLabel';

describe('appendProfileSuffix', () => {
  it('appends profile name in parentheses when enabled', () => {
    assert.equal(
      appendProfileSuffix('$(pulse) 42% usage', 'Work', true),
      '$(pulse) 42% usage (Work)'
    );
  });

  it('returns base text when showName is false', () => {
    assert.equal(
      appendProfileSuffix('$(pulse) 42% usage', 'Work', false),
      '$(pulse) 42% usage'
    );
  });

  it('returns base text when name is missing', () => {
    assert.equal(appendProfileSuffix('$(account) Select account', undefined, true), '$(account) Select account');
  });
});
