import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile } from '@cursor-accounts/types';
import { ProxyServerConfigurationBuilder } from '../../services/proxyServerConfigurationBuilder';

const profile = {
  id: 'profile-1',
  displayName: 'Profile 1',
  userDataDir: '/tmp/profile-1',
  proxyEnabled: true,
} as Profile;

describe('ProxyServerConfigurationBuilder', () => {
  it('builds child configuration from settings and profile context', () => {
    const values: Record<string, unknown> = {
      maxLogSizeMB: 250,
      maxBodyLogMB: 2.5,
      apiPortOffset: 9_000,
      spillLargeBodies: false,
      trafficDiagnostics: false,
      diagnosticsIntervalMs: 12_000,
    };
    const builder = new ProxyServerConfigurationBuilder({
      storageDir: '/tmp/storage',
      logDir: '/tmp/storage/logs',
      getConfig: (key, fallback) => (values[key] ?? fallback) as typeof fallback,
      isJsonlLoggingEnabled: () => true,
      createApiToken: () => 'fixed-token',
    });

    assert.deepEqual(builder.build(8080, profile), {
      port: 8080,
      apiPort: 17_080,
      apiToken: 'fixed-token',
      profileId: 'profile-1',
      storageDir: '/tmp/storage',
      logDir: '/tmp/storage/logs',
      maxLogSizeMb: 250,
      maxBodyLogBytes: 2.5 * 1024 * 1024,
      spillLargeBodies: false,
      developmentMode: true,
      trafficDiagnostics: false,
      diagnosticsIntervalMs: 12_000,
    });
  });

  it('clamps a non-positive body size and applies runtime overrides', () => {
    const builder = new ProxyServerConfigurationBuilder({
      storageDir: '/tmp/storage',
      logDir: '/tmp/logs',
      getConfig: <T>(_key: string, fallback: T) =>
        (fallback === 4 ? 0 : fallback) as T,
      isJsonlLoggingEnabled: () => false,
      createApiToken: () => 'generated',
    });

    assert.deepEqual(builder.build(8080, profile, {
      apiPort: 19_000,
      apiToken: 'override-token',
      profileId: 'shared',
    }), {
      port: 8080,
      apiPort: 19_000,
      apiToken: 'override-token',
      profileId: 'shared',
      storageDir: '/tmp/storage',
      logDir: '/tmp/logs',
      maxLogSizeMb: 500,
      maxBodyLogBytes: 1,
      spillLargeBodies: true,
      developmentMode: false,
      trafficDiagnostics: true,
      diagnosticsIntervalMs: 30_000,
    });
  });
});
