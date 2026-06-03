import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildLaunchArgs,
  buildManualLaunchCommand,
  buildSpawnEnv,
  proxyServerLaunchArg,
} from '../profiles/profileLauncher';

describe('ProfileLauncher proxy injection', () => {
  it('buildLaunchArgs omits --proxy-server when proxyUrl is not set', () => {
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

  it('buildLaunchArgs adds --proxy-server with profile proxy URL', () => {
    const args = buildLaunchArgs('/data/profile', undefined, {
      proxyUrl: 'http://127.0.0.1:8081',
    });
    assert.deepEqual(args, [
      '--user-data-dir',
      '/data/profile',
      '--proxy-server=http://127.0.0.1:8081',
    ]);
  });

  it('buildLaunchArgs uses distinct ports per profile proxy', () => {
    const a = buildLaunchArgs('/a', undefined, {
      proxyUrl: 'http://127.0.0.1:8080',
    });
    const b = buildLaunchArgs('/b', undefined, {
      proxyUrl: 'http://127.0.0.1:8081',
    });
    assert.equal(a[2], '--proxy-server=http://127.0.0.1:8080');
    assert.equal(b[2], '--proxy-server=http://127.0.0.1:8081');
  });

  it('proxyServerLaunchArg formats Chromium flag', () => {
    assert.equal(
      proxyServerLaunchArg('http://127.0.0.1:8888'),
      '--proxy-server=http://127.0.0.1:8888'
    );
  });

  it('buildManualLaunchCommand includes proxy flag when proxyUrl provided', () => {
    const command = buildManualLaunchCommand(
      '/data/profile',
      'http://127.0.0.1:8082'
    );
    assert.match(command, /--proxy-server=http:\/\/127\.0\.0\.1:8082/);
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
