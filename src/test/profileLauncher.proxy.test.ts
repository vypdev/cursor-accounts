import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLaunchArgs, buildSpawnEnv } from '../profiles/profileLauncher';

describe('ProfileLauncher proxy injection', () => {
  it('buildLaunchArgs includes --proxy-server when proxyUrl provided', () => {
    const args = buildLaunchArgs('/data/profile', undefined, 'http://127.0.0.1:8080');
    assert.deepEqual(args, [
      '--user-data-dir',
      '/data/profile',
      '--proxy-server',
      'http://127.0.0.1:8080',
    ]);
  });

  it('buildLaunchArgs omits proxy when proxyUrl not provided', () => {
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
