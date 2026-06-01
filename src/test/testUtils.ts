import assert from 'node:assert/strict';

/** Returns the first element or fails the test when the array is empty. */
export function first<T>(items: readonly T[], label = 'array item'): T {
  const value = items[0];
  if (value === undefined) {
    assert.fail(`Expected ${label} to be defined`);
  }
  return value;
}

/** Returns a value or fails the test when it is undefined. */
export function required<T>(value: T | undefined, label = 'value'): T {
  if (value === undefined) {
    assert.fail(`Expected ${label} to be defined`);
  }
  return value;
}
