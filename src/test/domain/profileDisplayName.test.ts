import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateProfileDisplayName } from '../../domain/policies/profileDisplayName';

describe('generateProfileDisplayName', () => {
  it('formats dotted and underscored local parts', () => {
    assert.equal(
      generateProfileDisplayName('john.doe_test@example.com'),
      'John Doe Test'
    );
  });

  it('formats the complete value when no domain separator exists', () => {
    assert.equal(generateProfileDisplayName('john_doe'), 'John Doe');
  });
});
