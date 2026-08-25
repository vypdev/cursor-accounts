import './registerVscodeMock';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CursorProcessScanner } from '../profiles/cursorProcessScanner';

describe('CursorProcessScanner', () => {
  it('uses the injected process provider without invoking host commands', async () => {
    const scanner = new CursorProcessScanner(async () => [
      { pid: 42, userDataDir: '/tmp/profile' },
    ]);

    assert.deepEqual(await scanner.scan(), [
      { pid: 42, userDataDir: '/tmp/profile' },
    ]);
  });

  it('scans Linux process output through the parser boundary', async () => {
    const scanner = new CursorProcessScanner(undefined, {
      platform: 'linux',
      execute: async () => ({
        stdout:
          '100 /usr/share/cursor/cursor --user-data-dir=/tmp/profile /tmp/repo\n',
      }),
    });

    assert.deepEqual(await scanner.scan(), [
      {
        pid: 100,
        userDataDir: '/tmp/profile',
        projectPath: '/tmp/repo',
      },
    ]);
  });

  it('falls back from PowerShell to wmic on Windows', async () => {
    const commands: string[] = [];
    const scanner = new CursorProcessScanner(undefined, {
      platform: 'win32',
      execute: async (command) => {
        commands.push(command);
        if (command.startsWith('powershell')) {
          throw Object.assign(new Error('PowerShell unavailable'), { code: 2 });
        }

        return {
          stdout:
            'CommandLine=C:\\Cursor\\Cursor.exe --user-data-dir=C:\\profile C:\\repo\nProcessId=200\n',
        };
      },
    });

    assert.deepEqual(await scanner.scan(), [
      {
        pid: 200,
        userDataDir: 'C:\\profile',
        projectPath: 'C:\\repo',
      },
    ]);
    assert.equal(commands.length, 2);
    assert.ok(commands[1]?.startsWith('wmic process'));
  });

  it('scans macOS process output and ignores helper processes', async () => {
    const scanner = new CursorProcessScanner(undefined, {
      platform: 'darwin',
      execute: async () => ({
        stdout:
          '300 Mon Jan 1 00:00:00 2024 /Applications/Cursor.app/Contents/MacOS/Cursor --user-data-dir=/tmp/profile /tmp/repo\n' +
          '301 Mon Jan 1 00:00:00 2024 /Applications/Cursor.app/Contents/MacOS/Cursor Helper --type=renderer\n',
      }),
    });

    assert.deepEqual(await scanner.scan(), [
      {
        pid: 300,
        userDataDir: '/tmp/profile',
        projectPath: '/tmp/repo',
      },
    ]);
  });
});
