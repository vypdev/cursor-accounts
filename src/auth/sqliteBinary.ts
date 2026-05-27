import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolves the path to the sqlite3 binary.
 * Tries bundled binary first, falls back to system binary.
 */
export function getSqlite3Binary(extensionPath: string): string {
  const platform = process.platform;
  const arch = process.arch;

  const binaryName = platform === 'win32' ? 'sqlite3.exe' : 'sqlite3';

  const bundledPath = path.join(
    extensionPath,
    'bin',
    `${platform}-${arch}`,
    binaryName
  );

  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  if (platform === 'darwin') {
    return '/usr/bin/sqlite3';
  }

  return 'sqlite3';
}
