import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALL_TARGETS,
  PLATFORM_SDK_PACKAGE,
  parseBuildArgs,
} from './build-targets.mjs';

const linuxArm64 = { platform: 'linux', arch: 'arm64' };

describe('build target resolution', () => {
  it('uses the current runtime target by default', () => {
    assert.deepEqual(parseBuildArgs([], linuxArm64), {
      all: false,
      current: false,
      targets: ['linux-arm64'],
    });
  });

  it('resolves --current independently from the host process', () => {
    assert.deepEqual(parseBuildArgs(['--current'], linuxArm64).targets, [
      'linux-arm64',
    ]);
  });

  it('resolves --all to the complete supported target matrix', () => {
    assert.deepEqual(parseBuildArgs(['--all'], linuxArm64).targets, ALL_TARGETS);
  });

  it('supports repeated explicit targets and the --target form', () => {
    assert.deepEqual(
      parseBuildArgs(
        ['--', 'darwin-arm64', '--target', 'win32-arm64', 'linux-x64'],
        linuxArm64
      ).targets,
      ['darwin-arm64', 'win32-arm64', 'linux-x64']
    );
  });

  it('gives --all precedence over --current and explicit targets', () => {
    assert.deepEqual(
      parseBuildArgs(['darwin-arm64', '--current', '--all'], linuxArm64).targets,
      ALL_TARGETS
    );
  });

  it('maps both Windows targets to the available SDK package', () => {
    assert.equal(
      PLATFORM_SDK_PACKAGE['win32-x64'],
      PLATFORM_SDK_PACKAGE['win32-arm64']
    );
  });

  it('rejects missing, invalid, and unknown arguments', () => {
    assert.throws(() => parseBuildArgs(['--target'], linuxArm64), /Invalid target/);
    assert.throws(
      () => parseBuildArgs(['--target', 'freebsd-x64'], linuxArm64),
      /Invalid target/
    );
    assert.throws(() => parseBuildArgs(['--wat'], linuxArm64), /Unknown argument/);
  });
});
