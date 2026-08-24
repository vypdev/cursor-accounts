/** Raw Cursor process info from OS inspection. */
export interface CursorProcess {
  pid: number;
  userDataDir?: string;
  projectPath?: string;
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

const KNOWN_LAUNCH_FLAGS = new Set([
  '--user-data-dir',
  '--proxy-server',
  '--new-window',
  '--reuse-window',
]);

/** Extract the project path argument from a Cursor launch command line. */
export function extractProjectPath(command: string): string | undefined {
  const args = tokenizeCommandLine(command);
  const pathCandidates: string[] = [];
  let executableSeen = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (KNOWN_LAUNCH_FLAGS.has(arg)) {
      index += 1;
      continue;
    }

    if (arg.startsWith('--user-data-dir=') || arg.startsWith('--proxy-server=')) {
      continue;
    }

    if (arg.startsWith('--')) {
      continue;
    }

    // The first positional argument is the Cursor executable itself, not a
    // workspace path. Only inspect positional arguments after it.
    if (!executableSeen) {
      executableSeen = true;
      continue;
    }

    if (arg.includes('/') || arg.includes('\\') || arg.endsWith('.code-workspace')) {
      pathCandidates.push(arg.replace(/^["']|["']$/g, ''));
    }
  }

  return pathCandidates.at(-1);
}

function tokenizeCommandLine(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (char === undefined) {
      continue;
    }

    if ((char === '"' || char === "'") && (!inQuotes || quoteChar === char)) {
      if (inQuotes && quoteChar === char) {
        inQuotes = false;
        quoteChar = '';
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
        continue;
      }

      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
        continue;
      }
    }

    if (!inQuotes && /\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
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

      const processInfo: CursorProcess = {
        pid,
        userDataDir: extractUserDataDir(command),
      };
      const projectPath = extractProjectPath(command);
      if (projectPath) {
        processInfo.projectPath = projectPath;
      }
      processes.push(processInfo);
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

      const processInfo: CursorProcess = {
        pid,
        userDataDir: extractUserDataDir(command),
      };
      const projectPath = extractProjectPath(command);
      if (projectPath) {
        processInfo.projectPath = projectPath;
      }
      processes.push(processInfo);
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

      const processInfo: CursorProcess = {
        pid,
        userDataDir: extractUserDataDir(command),
      };
      const projectPath = extractProjectPath(command);
      if (projectPath) {
        processInfo.projectPath = projectPath;
      }
      processes.push(processInfo);
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

      const processInfo: CursorProcess = {
        pid,
        userDataDir: extractUserDataDir(command),
      };
      const projectPath = extractProjectPath(command);
      if (projectPath) {
        processInfo.projectPath = projectPath;
      }
      processes.push(processInfo);
    } catch {
      continue;
    }
  }

  return processes;
}
