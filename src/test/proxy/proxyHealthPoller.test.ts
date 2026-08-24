import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pollProxyHealth } from '../../proxy/proxyHealthPoller';

describe('pollProxyHealth', () => {
  it('returns success when the authenticated health endpoint is ready', async () => {
    const originalFetch = globalThis.fetch;
    const requests: unknown[] = [];
    globalThis.fetch = async (input) => {
      requests.push(input);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    try {
      const result = await pollProxyHealth(18_080, 100, {}, 'a'.repeat(64));
      assert.deepEqual(result, { success: true });
      assert.equal(requests.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fails immediately when the child process has exited', async () => {
    const result = await pollProxyHealth(18_080, 100, {
      isProcessAlive: () => false,
      getStderr: () => 'startup failed',
    });

    assert.deepEqual(result, {
      success: false,
      error: 'Proxy process exited before API was ready: startup failed',
    });
  });

  it('returns a timeout error when the health endpoint never responds', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('not listening');
    };

    try {
      const result = await pollProxyHealth(
        18_080,
        5,
        { pollIntervalMs: 1 },
        'a'.repeat(64)
      );
      assert.equal(result.success, false);
      assert.match(result.error ?? '', /Proxy did not become ready within 5ms/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
