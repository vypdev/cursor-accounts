import './registerVscodeMock.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  migrateSecretsFromCursorQuota,
  migrateSettingsFromCursorQuota,
  LEGACY_SETTINGS_KEYS,
} from '../migrations/cursorQuotaMigration';

describe('cursorQuotaMigration', () => {
  it('exports legacy settings keys for migration coverage', () => {
    assert.ok(LEGACY_SETTINGS_KEYS.includes('refresh.enabled'));
    assert.ok(LEGACY_SETTINGS_KEYS.includes('profiles.refreshAllInterval'));
  });

  it('migrateSettingsFromCursorQuota returns a non-negative count', () => {
    const count = migrateSettingsFromCursorQuota();
    assert.ok(Number.isInteger(count));
    assert.ok(count >= 0);
  });

  it('migrateSecretsFromCursorQuota skips when new secrets exist', async () => {
    const context = {
      secrets: {
        get: async (key: string) =>
          key.includes('cursorAccounts') ? 'existing-token' : undefined,
        store: async () => undefined,
      },
    } as unknown as import('vscode').ExtensionContext;

    const result = await migrateSecretsFromCursorQuota(context);
    assert.equal(result.skipped, true);
    assert.equal(result.migratedTokenCount, 0);
  });

  it('migrateSecretsFromCursorQuota copies legacy secrets when missing', async () => {
    const stored = new Map<string, string>();
    const context = {
      secrets: {
        get: async (key: string) => stored.get(key),
        store: async (key: string, value: string) => {
          stored.set(key, value);
        },
      },
    } as unknown as import('vscode').ExtensionContext;

    stored.set('cursorQuota.accessToken', 'legacy-access');
    stored.set('cursorQuota.refreshToken', 'legacy-refresh');

    const result = await migrateSecretsFromCursorQuota(context);
    assert.equal(result.skipped, false);
    assert.equal(result.migratedTokenCount, 2);
    assert.equal(stored.get('cursorAccounts.accessToken'), 'legacy-access');
    assert.equal(stored.get('cursorAccounts.refreshToken'), 'legacy-refresh');
  });
});
