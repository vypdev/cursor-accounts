import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  extractUserDataDir,
  isHelperProcess,
  parseLinuxPsOutput,
  parseMacOSPsOutput,
  parseWindowsPowerShellJson,
  parseWindowsWmicOutput,
} from '../profiles/instanceDetector';

const FIXTURES_DIR = path.join(
  __dirname,
  '..',
  '..',
  'src',
  'test',
  'fixtures',
  'process-outputs'
);

async function readFixture(name: string): Promise<string> {
  return await fs.readFile(path.join(FIXTURES_DIR, name), 'utf8');
}

describe('InstanceDetector Process Parsing', () => {
  describe('isHelperProcess', () => {
    it('identifies helper processes', () => {
      assert.equal(isHelperProcess('Cursor Helper --type=gpu'), true);
      assert.equal(isHelperProcess('cursor --type=renderer'), true);
      assert.equal(
        isHelperProcess('/Applications/Cursor.app/Contents/MacOS/Cursor'),
        false
      );
    });
  });

  describe('extractUserDataDir', () => {
    it('extracts unquoted paths', () => {
      assert.equal(
        extractUserDataDir('cursor --user-data-dir=/home/test/.cursor-work'),
        '/home/test/.cursor-work'
      );
    });

    it('extracts quoted paths with spaces', () => {
      assert.equal(
        extractUserDataDir(
          'cursor --user-data-dir="/Users/test/My Profiles/work"'
        ),
        '/Users/test/My Profiles/work'
      );
    });

    it('extracts space-separated paths', () => {
      assert.equal(
        extractUserDataDir('cursor --user-data-dir /home/test/.cursor-work'),
        '/home/test/.cursor-work'
      );
    });

    it('returns undefined when flag is missing', () => {
      assert.equal(extractUserDataDir('cursor --verbose'), undefined);
    });
  });

  describe('macOS parsing', () => {
    it('parses valid ps output correctly', async () => {
      const stdout = await readFixture('macos-ps-output.txt');
      const processes = parseMacOSPsOutput(stdout);

      assert.equal(processes.length, 2);
      assert.deepEqual(processes[0], {
        pid: 12345,
        userDataDir: '/Users/test/.cursor-work',
      });
      assert.equal(processes[1].pid, 12347);
      assert.equal(processes[1].userDataDir, undefined);
    });

    it('handles malformed ps output gracefully', async () => {
      const stdout = await readFixture('malformed-output.txt');
      const processes = parseMacOSPsOutput(stdout);

      assert.equal(processes.length, 0);
    });

    it('handles paths with spaces', async () => {
      const stdout = await readFixture('macos-path-with-spaces.txt');
      const processes = parseMacOSPsOutput(stdout);

      assert.equal(processes.length, 1);
      assert.equal(
        processes[0].userDataDir,
        '/Users/test/My Profiles/work'
      );
    });

    it('handles empty output', () => {
      assert.deepEqual(parseMacOSPsOutput(''), []);
      assert.deepEqual(parseMacOSPsOutput('\n  \n'), []);
    });
  });

  describe('Windows PowerShell parsing', () => {
    it('parses JSON output correctly', async () => {
      const stdout = await readFixture('windows-powershell-output.json');
      const processes = parseWindowsPowerShellJson(stdout);

      assert.equal(processes.length, 2);
      assert.deepEqual(processes[0], {
        pid: 8888,
        userDataDir: 'C:\\Users\\test\\.cursor-work',
      });
      assert.equal(processes[1].pid, 8890);
      assert.equal(processes[1].userDataDir, undefined);
    });

    it('handles single process object output', () => {
      const stdout = JSON.stringify({
        Id: 1234,
        CommandLine:
          'C:\\Cursor.exe --user-data-dir=C:\\Users\\test\\.cursor-work',
      });

      const processes = parseWindowsPowerShellJson(stdout);
      assert.equal(processes.length, 1);
      assert.equal(processes[0].pid, 1234);
    });

    it('handles invalid JSON gracefully', () => {
      assert.throws(
        () => parseWindowsPowerShellJson('{ invalid json'),
        /Invalid JSON from PowerShell/
      );
    });

    it('handles empty output', () => {
      assert.deepEqual(parseWindowsPowerShellJson(''), []);
    });
  });

  describe('Windows wmic parsing', () => {
    it('parses wmic output correctly', async () => {
      const stdout = await readFixture('windows-wmic-output.txt');
      const processes = parseWindowsWmicOutput(stdout);

      assert.equal(processes.length, 1);
      assert.equal(processes[0].pid, 7777);
      assert.equal(
        processes[0].userDataDir,
        'C:\\Users\\test\\.cursor-work'
      );
    });
  });

  describe('Linux parsing', () => {
    it('parses ps output correctly', async () => {
      const stdout = await readFixture('linux-ps-output.txt');
      const processes = parseLinuxPsOutput(stdout);

      assert.equal(processes.length, 2);
      assert.deepEqual(processes[0], {
        pid: 9999,
        userDataDir: '/home/test/.cursor-work',
      });
      assert.equal(processes[1].pid, 10001);
      assert.equal(processes[1].userDataDir, undefined);
    });

    it('handles malformed output gracefully', async () => {
      const stdout = await readFixture('malformed-output.txt');
      const processes = parseLinuxPsOutput(stdout);

      assert.equal(processes.length, 0);
    });
  });

  describe('edge cases', () => {
    it('handles very long command lines', () => {
      const longArgs = '--flag '.repeat(200);
      const stdout = `  4321 /usr/bin/cursor ${longArgs} --user-data-dir=/home/test/.cursor-work`;
      const processes = parseLinuxPsOutput(stdout);

      assert.equal(processes.length, 1);
      assert.equal(processes[0].userDataDir, '/home/test/.cursor-work');
    });
  });
});
