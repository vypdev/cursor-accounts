import type { CursorProcess } from './cursorProcess';
import {
  parsePidCommandLine,
  parseProcessOutput,
} from './cursorProcessOutputParser';

const MACOS_PS_LINE_PATTERN = /^\s*(\d+)\s+(.+?)\s+(\/.*?)$/;

/** Parse macOS `ps` output into Cursor processes. */
export function parseMacOSPsOutput(stdout: string): CursorProcess[] {
  return parseProcessOutput(stdout, (line) =>
    parsePidCommandLine(line, MACOS_PS_LINE_PATTERN, 3)
  );
}
