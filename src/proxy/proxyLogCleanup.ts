import * as fs from 'fs/promises';
import * as path from 'path';

const LOG_FILE_PATTERN = /^proxy-.*\.jsonl$/;

export interface ProxyLogCleanupResult {
  deletedFiles: number;
  deletedBytes: number;
}

/**
 * Deletes only files created by the proxy logger and keeps the log directory.
 * Unexpected files and directories are deliberately left untouched.
 */
export async function clearProxyLogDirectory(
  logDir: string
): Promise<ProxyLogCleanupResult> {
  let entries: string[];
  try {
    entries = await fs.readdir(logDir);
  } catch (error) {
    if (isMissingPathError(error)) {
      return { deletedFiles: 0, deletedBytes: 0 };
    }
    throw error;
  }

  const candidates = entries
    .filter((entry) => LOG_FILE_PATTERN.test(entry))
    .map((entry) => path.join(logDir, entry));
  const bodiesDir = path.join(logDir, 'bodies');

  try {
    for (const entry of await fs.readdir(bodiesDir)) {
      if (entry.endsWith('.bin')) {
        candidates.push(path.join(bodiesDir, entry));
      }
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  let deletedFiles = 0;
  let deletedBytes = 0;
  for (const filePath of candidates) {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile()) {
      continue;
    }
    await fs.unlink(filePath);
    deletedFiles += 1;
    deletedBytes += stat.size;
  }

  return { deletedFiles, deletedBytes };
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
