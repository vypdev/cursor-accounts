import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractProjectPath,
  parseLinuxPsOutput,
} from '../profiles/instanceProcessParser';

describe('instanceProcessParser', () => {
  describe('extractProjectPath', () => {
    it('extracts the last project path from a launch command', () => {
      const command =
        '/Applications/Cursor.app/Contents/MacOS/Cursor --user-data-dir /Users/dev/.cursor-work /Users/dev/repo-two';

      assert.equal(
        extractProjectPath(command),
        '/Users/dev/repo-two'
      );
    });

    it('ignores proxy flags when extracting project path', () => {
      const command =
        'cursor --user-data-dir /Users/dev/.cursor-work --proxy-server=http://127.0.0.1:8081 /Users/dev/repo-one';

      assert.equal(
        extractProjectPath(command),
        '/Users/dev/repo-one'
      );
    });
  });

  describe('parseLinuxPsOutput', () => {
    it('includes projectPath when present in command line', () => {
      const stdout =
        ' 4242 /usr/bin/cursor --user-data-dir /home/dev/.cursor-work /home/dev/repo-one\n';

      const processes = parseLinuxPsOutput(stdout);

      assert.equal(processes.length, 1);
      assert.equal(processes[0]?.projectPath, '/home/dev/repo-one');
    });
  });
});
