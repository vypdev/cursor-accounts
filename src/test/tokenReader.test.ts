import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseStoredValue } from '../auth/tokenReader';

describe('parseStoredValue', () => {
  it('parses JSON-encoded strings', () => {
    assert.equal(parseStoredValue('"eyJhbGciOiJIUzI1NiJ9"'), 'eyJhbGciOiJIUzI1NiJ9');
  });

  it('returns plain strings unchanged', () => {
    assert.equal(parseStoredValue('plain-token'), 'plain-token');
  });

  it('returns undefined for empty values', () => {
    assert.equal(parseStoredValue(''), undefined);
    assert.equal(parseStoredValue(undefined), undefined);
  });
});
