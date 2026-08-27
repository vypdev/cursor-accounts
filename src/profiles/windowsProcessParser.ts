import type { CursorProcess } from './cursorProcess';
import { parseCursorProcess } from './cursorProcessCommand';

/** Parse Windows PowerShell JSON output into Cursor processes. */
export function parseWindowsPowerShellJson(stdout: string): CursorProcess[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  let processData: unknown;
  try {
    processData = JSON.parse(trimmed);
  } catch {
    throw new Error('Invalid JSON from PowerShell');
  }

  if (processData === null || processData === undefined) {
    return [];
  }

  const processArray = Array.isArray(processData) ? processData : [processData];
  const processes: CursorProcess[] = [];

  for (const proc of processArray) {
    if (!proc || typeof proc !== 'object' || !('Id' in proc)) {
      continue;
    }

    try {
      const entry = proc as { Id: unknown; CommandLine?: string };
      const pid = parseInt(String(entry.Id), 10);
      if (isNaN(pid)) {
        continue;
      }

      const processInfo = parseCursorProcess(pid, entry.CommandLine ?? '');
      if (processInfo) {
        processes.push(processInfo);
      }
    } catch {
      continue;
    }
  }

  return processes;
}

/** Parse Windows wmic output into Cursor processes. */
export function parseWindowsWmicOutput(stdout: string): CursorProcess[] {
  const processes: CursorProcess[] = [];

  for (const block of stdout.split('\n\n')) {
    if (!block.trim()) {
      continue;
    }

    try {
      const pidMatch = block.match(/ProcessId=(\d+)/);
      const commandMatch = block.match(/CommandLine=(.+)/);

      if (!pidMatch) {
        continue;
      }

      const pidStr = pidMatch[1];
      if (!pidStr) {
        continue;
      }

      const pid = parseInt(pidStr, 10);
      if (isNaN(pid)) {
        continue;
      }

      const processInfo = parseCursorProcess(pid, commandMatch?.[1] ?? '');
      if (processInfo) {
        processes.push(processInfo);
      }
    } catch {
      continue;
    }
  }

  return processes;
}
