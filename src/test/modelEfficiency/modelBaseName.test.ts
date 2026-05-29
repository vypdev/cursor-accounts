import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  modelBaseComparisonKey,
  normalizeModelBaseName,
} from '../../modelEfficiency/modelBaseName';

describe('modelBaseName', () => {
  it('normalizeModelBaseName strips variant suffixes', () => {
    assert.equal(normalizeModelBaseName('Composer 2.5 Fast'), 'Composer 2.5');
    assert.equal(normalizeModelBaseName('composer-2.5-fast'), 'composer-2.5');
    assert.equal(
      normalizeModelBaseName('Opus 4.6 Thinking'),
      'Opus 4.6'
    );
    assert.equal(
      normalizeModelBaseName('claude-4.6-opus-high-thinking'),
      'claude-4.6-opus'
    );
  });

  it('normalizeModelBaseName leaves special values unchanged', () => {
    assert.equal(normalizeModelBaseName('auto'), 'auto');
    assert.equal(normalizeModelBaseName('unknown'), 'unknown');
    assert.equal(normalizeModelBaseName(''), '');
  });

  it('modelBaseComparisonKey matches across naming styles', () => {
    assert.equal(
      modelBaseComparisonKey('Composer 2.5'),
      modelBaseComparisonKey('composer-2.5-fast')
    );
    assert.notEqual(
      modelBaseComparisonKey('composer-2.5-fast'),
      modelBaseComparisonKey('claude-4.6-opus-high-thinking')
    );
  });
});
