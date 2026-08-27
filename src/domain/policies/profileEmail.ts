import type { ValidationResult } from '@cursor-accounts/types';

/** Validate the email invariant used by profile creation and updates. */
export function validateProfileEmail(email: string): ValidationResult {
  const errors: string[] = [];

  if (!email || typeof email !== 'string') {
    errors.push('Email must be a non-empty string');
    return { valid: false, errors };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    errors.push('Email format is invalid');
  }

  if (email.length > 254) {
    errors.push('Email is too long (max 254 characters)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
