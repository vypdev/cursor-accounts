import type { CursorProcess } from './cursorProcess';

const KNOWN_LAUNCH_FLAGS = new Set([
  '--user-data-dir',
  '--proxy-server',
  '--new-window',
  '--reuse-window',
]);

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

/** Build a parsed Cursor process from a validated process id and command. */
export function parseCursorProcess(
  pid: number,
  command: string
): CursorProcess | undefined {
  if (isHelperProcess(command)) {
    return undefined;
  }

  const processInfo: CursorProcess = {
    pid,
    userDataDir: extractUserDataDir(command),
  };
  const projectPath = extractProjectPath(command);
  if (projectPath) {
    processInfo.projectPath = projectPath;
  }
  return processInfo;
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
