import * as crypto from 'crypto';

/**
 * Convert an email address to a URL-safe slug suitable for directory names.
 *
 * Examples:
 *   user@example.com → user_example_com
 *   first.last@domain.co.uk → first_last_domain_co_uk
 */
export function emailToSlug(email: string): string {
  if (!email || typeof email !== 'string') {
    throw new Error('Email must be a non-empty string');
  }

  const normalized = email
    .toLowerCase()
    .replace(/@/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  if (!normalized) {
    throw new Error('Email produced empty slug');
  }

  return normalized;
}

/**
 * Generate a short hash from email for collision resolution.
 * Returns first 8 characters of SHA256 hash.
 */
export function emailToHash(email: string): string {
  return crypto
    .createHash('sha256')
    .update(email.toLowerCase())
    .digest('hex')
    .substring(0, 8);
}

/**
 * Generate a unique slug with optional collision resolution.
 * If includeHash is true, appends hash to prevent collisions.
 */
export function generateUniqueSlug(email: string, includeHash = false): string {
  const baseSlug = emailToSlug(email);

  if (includeHash) {
    const hash = emailToHash(email);
    return `${baseSlug}_${hash}`;
  }

  return baseSlug;
}

/**
 * Validate that a slug is safe for use as a directory name.
 */
export function validateSlug(slug: string): boolean {
  const validPattern = /^[a-z0-9_]+$/;

  if (!slug || slug.length === 0 || slug.length > 200) {
    return false;
  }

  const reserved = ['con', 'prn', 'aux', 'nul', 'com1', 'lpt1'];
  if (reserved.includes(slug.toLowerCase())) {
    return false;
  }

  return validPattern.test(slug);
}
