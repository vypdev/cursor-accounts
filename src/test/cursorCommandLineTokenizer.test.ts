import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tokenizeCommandLine } from '../profiles/cursorCommandLineTokenizer';

describe('cursorCommandLineTokenizer', () => {
  it('splits unquoted arguments on whitespace', () => {
    assert.deepEqual(tokenizeCommandLine('cursor --verbose /tmp/repo'), [
      'cursor',
      '--verbose',
      '/tmp/repo',
    ]);
  });

  it('preserves spaces inside double-quoted arguments', () => {
    assert.deepEqual(
      tokenizeCommandLine('cursor --user-data-dir "/Users/dev/My Profiles"'),
      ['cursor', '--user-data-dir', '/Users/dev/My Profiles']
    );
  });

  it('supports single-quoted arguments and empty quoted arguments', () => {
    assert.deepEqual(
      tokenizeCommandLine("cursor --profile 'My Profile' \"\" /tmp/repo"),
      ['cursor', '--profile', 'My Profile', '/tmp/repo']
    );
  });

  it('preserves an unterminated quoted argument', () => {
    assert.deepEqual(
      tokenizeCommandLine('cursor "/Users/dev/My Profiles'),
      ['cursor', '/Users/dev/My Profiles']
    );
  });

  it('keeps mismatched quote characters inside a quoted argument', () => {
    assert.deepEqual(
      tokenizeCommandLine('cursor "C:\\Users\\dev\\My\'Repo"'),
      ["cursor", "C:\\Users\\dev\\My'Repo"]
    );
  });
});
