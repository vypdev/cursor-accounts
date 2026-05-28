import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  emailToHash,
  emailToSlug,
  generateUniqueSlug,
  validateSlug,
} from '../utils/emailToSlug';

describe('emailToSlug', () => {
  it('converts simple email to slug', () => {
    assert.equal(emailToSlug('user@example.com'), 'user_example_com');
  });

  it('handles dots in local part', () => {
    assert.equal(
      emailToSlug('first.last@domain.com'),
      'first_last_domain_com'
    );
  });

  it('handles plus addressing', () => {
    assert.equal(emailToSlug('user+tag@domain.com'), 'user_tag_domain_com');
  });

  it('handles multiple dots in domain', () => {
    assert.equal(
      emailToSlug('user@sub.domain.co.uk'),
      'user_sub_domain_co_uk'
    );
  });

  it('converts to lowercase', () => {
    assert.equal(emailToSlug('User@DOMAIN.COM'), 'user_domain_com');
  });

  it('removes consecutive underscores', () => {
    assert.equal(
      emailToSlug('user..name@domain.com'),
      'user_name_domain_com'
    );
  });

  it('throws on empty email', () => {
    assert.throws(() => emailToSlug(''), /non-empty string/);
  });

  it('throws on non-string input', () => {
    assert.throws(
      () => emailToSlug(null as unknown as string),
      /non-empty string/
    );
  });
});

describe('emailToHash', () => {
  it('generates consistent 8-character hash', () => {
    const hash1 = emailToHash('user@example.com');
    const hash2 = emailToHash('user@example.com');
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 8);
  });

  it('generates different hashes for different emails', () => {
    const hash1 = emailToHash('user1@example.com');
    const hash2 = emailToHash('user2@example.com');
    assert.notEqual(hash1, hash2);
  });

  it('is case-insensitive', () => {
    const hash1 = emailToHash('User@Example.COM');
    const hash2 = emailToHash('user@example.com');
    assert.equal(hash1, hash2);
  });
});

describe('generateUniqueSlug', () => {
  it('generates base slug without hash by default', () => {
    const slug = generateUniqueSlug('user@example.com');
    assert.equal(slug, 'user_example_com');
  });

  it('appends hash when requested', () => {
    const slug = generateUniqueSlug('user@example.com', true);
    assert.match(slug, /^user_example_com_[a-f0-9]{8}$/);
  });
});

describe('validateSlug', () => {
  it('accepts valid slugs', () => {
    assert.equal(validateSlug('user_example_com'), true);
    assert.equal(validateSlug('a1_b2_c3'), true);
  });

  it('rejects empty slug', () => {
    assert.equal(validateSlug(''), false);
  });

  it('rejects slugs with special characters', () => {
    assert.equal(validateSlug('user@example'), false);
    assert.equal(validateSlug('user.example'), false);
    assert.equal(validateSlug('user-example'), false);
  });

  it('rejects uppercase characters', () => {
    assert.equal(validateSlug('User_Example'), false);
  });

  it('rejects Windows reserved names', () => {
    assert.equal(validateSlug('con'), false);
    assert.equal(validateSlug('prn'), false);
    assert.equal(validateSlug('aux'), false);
  });

  it('rejects too long slugs', () => {
    const longSlug = 'a'.repeat(201);
    assert.equal(validateSlug(longSlug), false);
  });
});
