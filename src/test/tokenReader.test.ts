import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import {
  parseStoredValue,
  validateStateDbPath,
} from '../auth/tokenReader';

describe('parseStoredValue', () => {
  it('parses JSON-encoded strings', () => {
    assert.equal(parseStoredValue('"eyJhbGciOiJIUzI1NiJ9"'), 'eyJhbGciOiJIUzI1NiJ9');
  });

  it('returns plain strings unchanged', () => {
    assert.equal(parseStoredValue('plain-token'), 'plain-token');
  });

  it('returns undefined for empty values', () => {
    assert.equal(parseStoredValue(''), undefined);
    assert.equal(parseStoredValue(undefined), undefined);
  });
});

describe('validateStateDbPath', () => {
  it('accepts paths within home directory', () => {
    const dbPath = path.join(
      os.homedir(),
      '.cursor-test',
      'User',
      'globalStorage',
      'state.vscdb'
    );
    assert.doesNotThrow(() => validateStateDbPath(dbPath));
  });

  it('rejects paths outside home directory', () => {
    assert.throws(
      () => validateStateDbPath('/etc/passwd'),
      /within user home directory/
    );
  });
});
