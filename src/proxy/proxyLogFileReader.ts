import * as fs from 'fs/promises';
import * as path from 'path';

const LOG_FILE_PREFIX = 'proxy-';
const LOG_FILE_EXT = '.jsonl';

export interface ProxyLogFileMetadata {
  filePath: string;
  mtime: number;
  size: number;
}

export type ProxyLogFileReadResult =
  | { kind: 'missing' }
  | { kind: 'data'; chunk: string; nextOffset: number; truncated: boolean }
  | { kind: 'unchanged'; truncated: boolean };

export async function findProxyLogFiles(
  logDir: string
): Promise<ProxyLogFileMetadata[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(logDir);
  } catch {
    return [];
  }

  const candidates = entries
    .filter((name) => name.startsWith(LOG_FILE_PREFIX) && name.endsWith(LOG_FILE_EXT))
    .map((name) => path.join(logDir, name));

  const files = (
    await Promise.all(
      candidates.map(async (filePath) => {
        try {
          const stat = await fs.stat(filePath);
          return { filePath, mtime: stat.mtimeMs, size: stat.size };
        } catch {
          return null;
        }
      })
    )
  ).filter((value): value is NonNullable<typeof value> => value !== null);

  files.sort((left, right) => left.mtime - right.mtime || comparePaths(left.filePath, right.filePath));
  return files;
}

export async function readProxyLogFile(
  filePath: string,
  fileOffset: number
): Promise<ProxyLogFileReadResult> {
  let size: number;
  try {
    size = (await fs.stat(filePath)).size;
  } catch {
    return { kind: 'missing' };
  }

  const truncated = size < fileOffset;
  const readOffset = truncated ? 0 : fileOffset;
  if (size === readOffset) {
    return { kind: 'unchanged', truncated };
  }

  const handle = await fs.open(filePath, 'r');
  try {
    const length = size - readOffset;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, readOffset);
    return {
      kind: 'data',
      chunk: buffer.subarray(0, bytesRead).toString('utf8'),
      nextOffset: readOffset + bytesRead,
      truncated,
    };
  } finally {
    await handle.close();
  }
}

/** Lists proxy JSONL files in logDir sorted by mtime (oldest first). */
export async function listProxyLogFiles(logDir: string): Promise<string[]> {
  const files = await findProxyLogFiles(logDir);
  return files.map((file) => file.filePath);
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
