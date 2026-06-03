import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLaunchArgs, buildSpawnEnv } from '../profiles/profileLauncher';

describe('ProfileLauncher proxy injection', () => {
  it('buildLaunchArgs does not include --proxy-server (proxy via settings.json)', () => {
    const args = buildLaunchArgs('/data/profile', '/project/path');
    assert.deepEqual(args, [
      '--user-data-dir',
      '/data/profile',
      '/project/path',
    ]);
  });

  it('buildLaunchArgs includes only user-data-dir when no project', () => {
    const args = buildLaunchArgs('/data/profile');
    assert.deepEqual(args, ['--user-data-dir', '/data/profile']);
  });

  it('buildSpawnEnv sets NODE_EXTRA_CA_CERTS when ca path provided', () => {
    const env = buildSpawnEnv('/tmp/ca-cert.pem');
    assert.equal(env.NODE_EXTRA_CA_CERTS, '/tmp/ca-cert.pem');
  });

  it('buildSpawnEnv does not set NODE_EXTRA_CA_CERTS by default', () => {
    const env = buildSpawnEnv();
    assert.equal(env.NODE_EXTRA_CA_CERTS, undefined);
  });
});
