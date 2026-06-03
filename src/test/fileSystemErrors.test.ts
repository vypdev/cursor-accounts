import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getErrorCode,
  isBusyError,
  isNotFoundError,
  isPermissionError,
} from '../utils/fileSystemErrors';

describe('fileSystemErrors', () => {
  it('detects ENOENT', () => {
    assert.equal(isNotFoundError({ code: 'ENOENT' }), true);
    assert.equal(isNotFoundError({ code: 'EACCES' }), false);
  });

  it('detects permission errors', () => {
    assert.equal(isPermissionError({ code: 'EACCES' }), true);
    assert.equal(isPermissionError({ code: 'EPERM' }), true);
    assert.equal(isPermissionError({ code: 'ENOENT' }), false);
  });

  it('detects busy errors', () => {
    assert.equal(isBusyError({ code: 'EBUSY' }), true);
  });

  it('returns undefined code for non-errors', () => {
    assert.equal(getErrorCode('string'), undefined);
    assert.equal(getErrorCode(null), undefined);
  });
});
