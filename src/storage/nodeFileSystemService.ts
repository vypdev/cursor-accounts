import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  FileStat,
  FileSystemOperationResult,
  IFileSystemService,
} from '../domain/ports/IFileSystemService';
import {
  handleFileSystemError,
  isNotFoundError,
} from '../utils/fileSystemErrors';

/** Node.js `fs/promises` adapter for {@link IFileSystemService}. */
export class NodeFileSystemService implements IFileSystemService {
  async stat(targetPath: string): Promise<FileStat | null> {
    try {
      const stat = await fs.stat(targetPath);
      return {
        size: stat.size,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      return handleFileSystemError(error, null, `Cannot stat ${targetPath}`);
    }
  }

  async getFileSize(filePath: string): Promise<number> {
    const stat = await this.stat(filePath);
    return stat?.isFile ? stat.size : 0;
  }

  async getPathSize(
    targetPath: string,
    options?: { exclude?: (name: string) => boolean }
  ): Promise<number> {
    try {
      const stat = await this.stat(targetPath);
      if (!stat) {
        return 0;
      }
      if (stat.isFile) {
        return stat.size;
      }
      if (!stat.isDirectory) {
        return 0;
      }

      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      let total = 0;
      for (const entry of entries) {
        if (options?.exclude?.(entry.name)) {
          continue;
        }
        total += await this.getPathSize(path.join(targetPath, entry.name), options);
      }
      return total;
    } catch (error) {
      return handleFileSystemError(error, 0, `Cannot read size of ${targetPath}`);
    }
  }

  async removeDirectory(dirPath: string): Promise<FileSystemOperationResult> {
    try {
      const entry = await this.stat(dirPath);
      if (!entry?.isDirectory) {
        return { bytes: 0, notFound: true };
      }

      const size = await this.getPathSize(dirPath);
      await fs.rm(dirPath, { recursive: true, force: true });
      return { bytes: size };
    } catch (error) {
      if (isNotFoundError(error)) {
        return { bytes: 0, notFound: true };
      }
      handleFileSystemError(error, undefined, `Cannot remove ${dirPath}`);
      return { bytes: 0 };
    }
  }

  async copyFile(source: string, destination: string): Promise<void> {
    try {
      await fs.copyFile(source, destination);
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new Error(`Cannot copy ${source}: file not found`);
      }
      handleFileSystemError(error, undefined, `Cannot copy ${source}`);
    }
  }
}
