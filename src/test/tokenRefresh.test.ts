import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import { TokenService } from '../auth/tokenRefresh';
import { getProfileSecretsKeys, getProfileStateDbPath } from '../auth/cursorPaths';

describe('TokenService profile scoping', () => {
  it('resolves active state database from profile detector user data dir', () => {
    const activeUserDataDir = path.join(os.tmpdir(), 'cursor-profile-work');
    const profileDetector = {
      getCurrentUserDataDir: () => activeUserDataDir,
    };

    const service = new TokenService({ extensionPath: '/tmp/ext' } as never, profileDetector as never);
    const stateDbPath = service.getActiveStateDbPath();

    assert.equal(stateDbPath, getProfileStateDbPath(activeUserDataDir));
    assert.ok(stateDbPath.includes('cursor-profile-work'));
  });

  it('generates distinct profile-scoped secret keys per user data dir', () => {
    const dirA = path.join(os.tmpdir(), 'profile-a');
    const dirB = path.join(os.tmpdir(), 'profile-b');

    const keysA = getProfileSecretsKeys(dirA);
    const keysB = getProfileSecretsKeys(dirB);

    assert.notEqual(keysA.accessToken, keysB.accessToken);
    assert.match(keysA.accessToken, /^cursorAccounts\.accessToken\./);
    assert.match(keysB.accessToken, /^cursorAccounts\.accessToken\./);
  });
});
