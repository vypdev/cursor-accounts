import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPercent,
  formatCents,
  formatPercent,
  renderProgressBar,
} from '../utils/formatters';

describe('formatters', () => {
  it('clampPercent bounds values', () => {
    assert.equal(clampPercent(-5), 0);
    assert.equal(clampPercent(150), 100);
    assert.equal(clampPercent(46.4), 46);
    assert.equal(clampPercent(Number.NaN), 0);
  });

  it('formatPercent renders rounded percent', () => {
    assert.equal(formatPercent(46.4), '46%');
    assert.equal(formatPercent(100), '100%');
  });

  it('renderProgressBar fills blocks by percent', () => {
    assert.equal(renderProgressBar(0, 8), '░░░░░░░░');
    assert.equal(renderProgressBar(100, 8), '▓▓▓▓▓▓▓▓');
    assert.equal(renderProgressBar(50, 4).length, 4);
  });

  it('formatCents converts to dollars', () => {
    assert.equal(formatCents(23222), '$232.22');
    assert.equal(formatCents(0), '$0.00');
  });
});
