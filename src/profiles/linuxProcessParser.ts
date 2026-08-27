import type { CursorProcess } from './cursorProcess';
import { parseProcessOutput } from './cursorProcessOutputParser';

/** Parse Linux `ps` output into Cursor processes. */
export function parseLinuxPsOutput(stdout: string): CursorProcess[] {
  return parseProcessOutput(stdout, (line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) {
      return undefined;
    }

    const pidStr = match[1];
    const command = match[2];
    if (!pidStr || !command) {
      return undefined;
    }

    const pid = parseInt(pidStr, 10);
    if (isNaN(pid)) {
      return undefined;
    }

    return { pid, command };
  });
}
