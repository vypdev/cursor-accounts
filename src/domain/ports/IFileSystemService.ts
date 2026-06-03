/** Metadata for a file or directory entry. */
export interface FileStat {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
}

/** Result of a filesystem operation that may fail for expected reasons. */
export interface FileSystemOperationResult {
  bytes: number;
  /** Set when the path did not exist (ENOENT). */
  notFound?: boolean;
}

/**
 * Port for filesystem reads and destructive cleanup operations.
 * Keeps storage logic independent of Node.js `fs` APIs.
 */
export interface IFileSystemService {
  /** Stat a path; returns null when the path does not exist. */
  stat(targetPath: string): Promise<FileStat | null>;

  /** Size of a single file, or 0 when missing. */
  getFileSize(filePath: string): Promise<number>;

  /** Recursive size of a file or directory tree. */
  getPathSize(
    targetPath: string,
    options?: { exclude?: (name: string) => boolean }
  ): Promise<number>;

  /**
   * Remove a directory tree and return bytes reclaimed.
   * @throws Error with code EACCES when permission is denied.
   */
  removeDirectory(dirPath: string): Promise<FileSystemOperationResult>;

  /**
   * Copy a file.
   * @throws Error with code EACCES when permission is denied.
   */
  copyFile(source: string, destination: string): Promise<void>;
}
