import type { CursorProcess } from './cursorProcess';
import { parseProcessOutput } from './cursorProcessOutputParser';

/** Parse macOS `ps` output into Cursor processes. */
export function parseMacOSPsOutput(stdout: string): CursorProcess[] {
  return parseProcessOutput(stdout, (line) => {
    const match = line.match(/^\s*(\d+)\s+(.+?)\s+(\/.*?)$/);
    if (!match) {
      return undefined;
    }

    const pidStr = match[1];
    const command = match[3];
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
