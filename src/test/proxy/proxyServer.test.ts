import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseProxyServerConfig } from '../../proxy/proxyServer';

function validConfig(): Record<string, unknown> {
  return {
    port: 8080,
    apiPort: 18080,
    apiToken: 'a'.repeat(64),
    profileId: 'profile-a',
    storageDir: '/tmp/proxy',
    logDir: '/tmp/proxy/logs',
    maxLogSizeMb: 50,
    maxBodyLogBytes: 1024,
    spillLargeBodies: true,
    developmentMode: true,
    trafficDiagnostics: false,
    diagnosticsIntervalMs: 30_000,
    userIdToProfileId: { user: 'profile-a' },
    profileDbPaths: { 'profile-a': '/tmp/profile/efficiency.db' },
    extensionPath: '/tmp/extension',
  };
}

describe('parseProxyServerConfig', () => {
  it('accepts a complete child-process configuration', () => {
    const config = parseProxyServerConfig(JSON.stringify(validConfig()));

    assert.equal(config.apiPort, 18_080);
    assert.equal(config.apiToken, 'a'.repeat(64));
    assert.equal(config.profileDbPaths?.['profile-a'], '/tmp/profile/efficiency.db');
  });

  it('rejects malformed JSON with an actionable error', () => {
    assert.throws(
      () => parseProxyServerConfig('{'),
      /CURSOR_ACCOUNTS_PROXY_CONFIG is not valid JSON/
    );
  });

  it('rejects missing required fields and weak capability tokens', () => {
    const config = validConfig();
    delete config.logDir;
    config.apiToken = 'short';

    assert.throws(
      () => parseProxyServerConfig(JSON.stringify(config)),
      /CURSOR_ACCOUNTS_PROXY_CONFIG is invalid: .*apiToken: String must contain at least 32 character\(s\); logDir: Required/
    );
  });

  it('rejects invalid ports and non-positive limits', () => {
    const config = validConfig();
    config.apiPort = 70_000;
    config.maxBodyLogBytes = 0;

    assert.throws(
      () => parseProxyServerConfig(JSON.stringify(config)),
      /apiPort: Number must be less than or equal to 65535; maxBodyLogBytes: Number must be greater than 0/
    );
  });

  it('rejects non-object JSON values instead of coercing them', () => {
    assert.throws(
      () => parseProxyServerConfig(JSON.stringify(['unexpected'])) ,
      /CURSOR_ACCOUNTS_PROXY_CONFIG is invalid: <root>: Expected object, received array/
    );
  });
});
