import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * Normalize a path for consistent comparison across platforms.
 *
 * Normalization rules:
 * 1. Convert to absolute path
 * 2. Normalize separators (path.normalize handles platform differences)
 * 3. Convert to lowercase on Windows only (for case-insensitive comparison)
 * 4. Remove trailing slashes
 */
export function normalizePath(inputPath: string): string {
  const absolute = path.resolve(inputPath);
  const normalized = path.normalize(absolute);

  const caseNormalized =
    process.platform === 'win32' ? normalized.toLowerCase() : normalized;

  const withoutTrailing =
    caseNormalized.endsWith(path.sep) && caseNormalized.length > 1
      ? caseNormalized.slice(0, -1)
      : caseNormalized;

  return withoutTrailing;
}

/**
 * Compare two paths for equality.
 * Handles platform differences (case sensitivity, separators).
 */
export function pathsEqual(path1: string, path2: string): boolean {
  return normalizePath(path1) === normalizePath(path2);
}

/**
 * Validate that a path is safe for use as a user data directory.
 *
 * Security checks:
 * 1. Must be absolute path
 * 2. Must be within user's home directory
 * 3. Must not be a system directory
 * 4. Must not be the root directory
 */
export function validateUserDataPath(userDataDir: string): {
  valid: boolean;
  error?: string;
} {
  if (!path.isAbsolute(userDataDir)) {
    return {
      valid: false,
      error: 'Path must be absolute',
    };
  }

  const normalized = path.normalize(path.resolve(userDataDir));
  const home = path.normalize(os.homedir());

  if (!normalized.startsWith(home)) {
    return {
      valid: false,
      error: 'Path must be within user home directory',
    };
  }

  if (normalized === home) {
    return {
      valid: false,
      error: 'Path cannot be home directory itself',
    };
  }

  if (normalized === path.sep) {
    return {
      valid: false,
      error: 'Path cannot be root directory',
    };
  }

  const systemDirs =
    process.platform === 'win32'
      ? [
          'C:\\Windows',
          'C:\\Program Files',
          'C:\\Program Files (x86)',
          'C:\\ProgramData',
        ]
      : ['/System', '/usr', '/bin', '/sbin', '/etc', '/var'];

  for (const sysDir of systemDirs) {
    const normalizedSysDir = path.normalize(sysDir);
    if (normalized.startsWith(normalizedSysDir)) {
      return {
        valid: false,
        error: `Path cannot be within system directory: ${sysDir}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate that a state.vscdb path is safe to read.
 * Path must be within the user's home directory and not a system directory.
 */
export function validateStateDbPath(dbPath: string): void {
  const normalized = path.normalize(path.resolve(dbPath));
  const home = path.normalize(os.homedir());

  if (!normalized.startsWith(home)) {
    throw new Error('Database path must be within user home directory');
  }

  const systemDirs =
    process.platform === 'win32'
      ? ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)']
      : ['/', '/System', '/usr', '/bin', '/sbin', '/etc'];

  for (const sysDir of systemDirs) {
    const normalizedSysDir = path.normalize(sysDir);
    if (normalizedSysDir === path.sep) {
      if (normalized === path.sep) {
        throw new Error('Cannot read from system directory');
      }
      continue;
    }
    if (normalized.startsWith(normalizedSysDir)) {
      throw new Error('Cannot read from system directory');
    }
  }
}

/**
 * Ensure a path exists and is a directory.
 * Creates the directory if it doesn't exist.
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path exists but is not a directory: ${dirPath}`);
    }
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      await fs.mkdir(dirPath, { recursive: true });
    } else {
      throw error;
    }
  }
}
