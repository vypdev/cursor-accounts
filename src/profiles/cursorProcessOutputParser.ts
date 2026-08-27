import type { CursorProcess } from './cursorProcess';
import { parseCursorProcess } from './cursorProcessCommand';

export interface ParsedProcessEntry {
  pid: number;
  command: string;
}

export type ProcessLineParser = (
  line: string
) => ParsedProcessEntry | undefined;

/** Parse a PID and command capture from a platform-specific process line. */
export function parsePidCommandLine(
  line: string,
  pattern: RegExp,
  commandGroup: number
): ParsedProcessEntry | undefined {
  const match = line.match(pattern);
  if (!match) {
    return undefined;
  }

  const pidStr = match[1];
  const command = match[commandGroup];
  if (!pidStr || !command) {
    return undefined;
  }

  const pid = parseInt(pidStr, 10);
  if (isNaN(pid)) {
    return undefined;
  }

  return { pid, command };
}

/** Parse line-oriented process output with a platform-specific line parser. */
export function parseProcessOutput(
  stdout: string,
  parseLine: ProcessLineParser
): CursorProcess[] {
  const processes: CursorProcess[] = [];

  for (const line of stdout.trim().split('\n')) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = parseLine(line);
      if (!entry) {
        continue;
      }

      const processInfo = parseCursorProcess(entry.pid, entry.command);
      if (processInfo) {
        processes.push(processInfo);
      }
    } catch {
      continue;
    }
  }

  return processes;
}
