import type { CursorProcess } from './cursorProcess';
import {
  parsePidCommandLine,
  parseProcessOutput,
} from './cursorProcessOutputParser';

const LINUX_PS_LINE_PATTERN = /^\s*(\d+)\s+(.+)$/;

/** Parse Linux `ps` output into Cursor processes. */
export function parseLinuxPsOutput(stdout: string): CursorProcess[] {
  return parseProcessOutput(stdout, (line) =>
    parsePidCommandLine(line, LINUX_PS_LINE_PATTERN, 2)
  );
}
