import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redactSensitive } from '../../../proxy/insights/sensitiveRedaction';

describe('sensitiveRedaction', () => {
  it('redacts sensitive keys recursively inside arrays', () => {
    const result = redactSensitive({
      headers: [{ Authorization: 'secret', value: 'ok' }],
      nested: { refresh_token: 'refresh-secret' },
    }) as {
      headers: Array<Record<string, unknown>>;
      nested: Record<string, unknown>;
    };

    assert.equal(result.headers[0]?.Authorization, '[REDACTED]');
    assert.equal(result.headers[0]?.value, 'ok');
    assert.equal(result.nested.refresh_token, '[REDACTED]');
  });

  it('preserves primitive values and stops at the recursion limit', () => {
    const nested: Record<string, unknown> = { value: 'secret' };
    let current = nested;
    for (let depth = 0; depth < 13; depth += 1) {
      const next: Record<string, unknown> = {};
      current.child = next;
      current = next;
    }

    const result = redactSensitive({ value: 1, nested }) as Record<
      string,
      unknown
    >;
    assert.equal(result.value, 1);
    assert.equal(
      (result.nested as Record<string, unknown>).child !== undefined,
      true
    );
  });
});
