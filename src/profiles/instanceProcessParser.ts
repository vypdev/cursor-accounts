/** Raw Cursor process info from OS inspection. */
export interface CursorProcess {
  pid: number;
  userDataDir?: string;
  startTime?: number;
}

/** Returns true if the command line belongs to a helper process. */
export function isHelperProcess(command: string): boolean {
  return command.includes('Helper') || command.includes('--type=');
}

/** Extract --user-data-dir from a process command line. */
export function extractUserDataDir(command: string): string | undefined {
  const match = command.match(
    /--user-data-dir(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s"']+))/
  );
  if (!match) {
    return undefined;
  }

  const value = match[1] ?? match[2] ?? match[3];
  return value?.replace(/"/g, '');
}

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

      if (isHelperProcess(command)) {
        continue;
      }

      processes.push({
        pid,
        userDataDir: extractUserDataDir(command),
      });
    } catch {
      continue;
    }
  }

  return processes;
}

/** Parse Linux `ps` output into Cursor processes. */
export function parseLinuxPsOutput(stdout: string): CursorProcess[] {
  const processes: CursorProcess[] = [];

  for (const line of stdout.trim().split('\n')) {
    if (!line.trim()) {
      continue;
    }

    try {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      if (!match) {
        continue;
      }

      const pidStr = match[1];
      const command = match[2];
      if (!pidStr || !command) {
        continue;
      }

      const pid = parseInt(pidStr, 10);
      if (isNaN(pid)) {
        continue;
      }

      if (isHelperProcess(command)) {
        continue;
      }

      processes.push({
        pid,
        userDataDir: extractUserDataDir(command),
      });
    } catch {
      continue;
    }
  }

  return processes;
}

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

      const command = entry.CommandLine ?? '';

      if (isHelperProcess(command)) {
        continue;
      }

      processes.push({
        pid,
        userDataDir: extractUserDataDir(command),
      });
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

      const command = commandMatch?.[1] ?? '';

      if (isHelperProcess(command)) {
        continue;
      }

      processes.push({
        pid,
        userDataDir: extractUserDataDir(command),
      });
    } catch {
      continue;
    }
  }

  return processes;
}
