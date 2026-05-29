import './../registerVscodeMock';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ApiKeyManager } from '../../modelEfficiency/apiKeyManager';
import { getEfficiencyApiKeySecretKey } from '../../modelEfficiency/paths';
import { EFFICIENCY_API_KEY_NAME } from '../../modelEfficiency/types';

const originalFetch = globalThis.fetch;

describe('ApiKeyManager', () => {
  const secrets = new Map<string, string>();
  const contextSecrets = {
    store: async (key: string, value: string) => {
      secrets.set(key, value);
    },
    get: async (key: string) => secrets.get(key),
    delete: async (key: string) => {
      secrets.delete(key);
    },
  };

  const context = {
    secrets: contextSecrets,
  } as unknown as import('vscode').ExtensionContext;

  beforeEach(() => {
    secrets.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('createApiKey posts dashboard endpoint and stores secret', async () => {
    let capturedBody: unknown;
    let capturedCookie: string | undefined;

    globalThis.fetch = async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      const headers = init?.headers as Record<string, string>;
      capturedCookie = headers.Cookie;
      return {
        ok: true,
        json: async () => ({ apiKey: 'crsr_test_key_123' }),
      } as Response;
    };

    const manager = new ApiKeyManager(context);
    const key = await manager.createApiKey(
      'profile-uuid',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdXRoMHx1c2VyXzAxSk5FN1FNQUtDMk1ZUFhOU0NNNjhBQUdWIn0.sig'
    );

    assert.equal(key, 'crsr_test_key_123');
    assert.deepEqual(capturedBody, { name: EFFICIENCY_API_KEY_NAME });
    assert.ok(capturedCookie?.includes('WorkosCursorSessionToken='));

    const stored = await contextSecrets.get(
      getEfficiencyApiKeySecretKey('profile-uuid')
    );
    assert.equal(stored, 'crsr_test_key_123');
  });

  it('deleteApiKey removes stored secret', async () => {
    const manager = new ApiKeyManager(context);
    await contextSecrets.store(
      getEfficiencyApiKeySecretKey('p2'),
      'crsr_old'
    );
    await manager.deleteApiKey('p2');
    const stored = await manager.getApiKey('p2');
    assert.equal(stored, undefined);
  });
});
