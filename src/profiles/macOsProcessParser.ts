import type { CursorProcess } from './cursorProcess';
import { parseCursorProcess } from './cursorProcessCommand';

/** Parse macOS `ps` output into Cursor processes. */
export function parseMacOSPsOutput(stdout: string): CursorProcess[] {
  const processes: CursorProcess[] = [];

  for (const line of stdout.trim().split('\n')) {
    if (!line.trim()) {
      continue;
    }

    try {
      const match = line.match(/^\s*(\d+)\s+(.+?)\s+(\/.*?)$/);
      if (!match) {
        continue;
      }

      const pidStr = match[1];
      const command = match[3];
      if (!pidStr || !command) {
        continue;
      }

      const pid = parseInt(pidStr, 10);
      if (isNaN(pid)) {
        continue;
      }

      const processInfo = parseCursorProcess(pid, command);
      if (processInfo) {
        processes.push(processInfo);
      }
    } catch {
      continue;
    }
  }

  return processes;
}
