import type { CursorProcess } from './cursorProcess';
import { parseCursorProcess } from './cursorProcessCommand';

export interface ParsedProcessEntry {
  pid: number;
  command: string;
}

export type ProcessLineParser = (
  line: string
) => ParsedProcessEntry | undefined;

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
