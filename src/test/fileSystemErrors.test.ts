import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getErrorCode,
  isBusyError,
  isNotFoundError,
  isPermissionError,
  isStorageFullError,
  handleFileSystemError,
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

  it('detects storage-full errors and provides an actionable message', () => {
    assert.equal(isStorageFullError({ code: 'ENOSPC' }), true);
    assert.throws(
      () => handleFileSystemError({ code: 'ENOSPC' }, 0, 'Cannot write cache'),
      /no space left on device/i
    );
  });

  it('returns undefined code for non-errors', () => {
    assert.equal(getErrorCode('string'), undefined);
    assert.equal(getErrorCode(null), undefined);
  });
});
