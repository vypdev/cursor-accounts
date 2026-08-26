import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertVsixArtifact } from './vsixVerification.mjs';

function inspection(overrides = {}) {
  return {
    checks: [
      { label: 'webview bundle', present: true },
      { label: '@cursor/sdk', present: true },
    ],
    forbidden: [],
    nativeError: undefined,
    nativeTarget: 'darwin-arm64',
    ...overrides,
  };
}

describe('VSIX verifier contract', () => {
  it('accepts a complete artifact for the requested native target', () => {
    assert.doesNotThrow(() =>
      assertVsixArtifact(inspection(), { target: 'darwin-arm64' })
    );
  });

  it('rejects missing required content', () => {
    assert.throws(
      () =>
        assertVsixArtifact(
          inspection({
            checks: [{ label: 'webview bundle', present: false }],
          }),
          { target: 'darwin-arm64' }
        ),
      /missing webview bundle/
    );
  });

  it('rejects development artifacts and invalid native targets', () => {
    assert.throws(
      () =>
        assertVsixArtifact(
          inspection({
            forbidden: [{ pattern: 'extension/docs/', present: true }],
          }),
          { target: 'darwin-arm64' }
        ),
      /forbidden artifact extension\/docs\//
    );
    assert.throws(
      () =>
        assertVsixArtifact(
          inspection({ nativeTarget: 'linux-arm64' }),
          { target: 'darwin-arm64' }
        ),
      /expected native target darwin-arm64, got linux-arm64/
    );
  });

  it('rejects a missing native binding when a target is required', () => {
    assert.throws(
      () =>
        assertVsixArtifact(
          inspection({ nativeError: new Error('native binding entry not found') }),
          { target: 'darwin-arm64' }
        ),
      /native binding entry not found/
    );
  });
});
