import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { WorkspaceInfo } from '@cursor-accounts/types';
import type { IWorkspaceScanner } from '../domain/ports/IWorkspaceScanner';
import * as extensionLog from '../logging/extensionLog';

const MAX_WORKSPACES = 50;

interface WorkspaceJson {
  folder?: string;
  workspace?: string;
}

/**
 * Scans a profile's workspaceStorage directories for opened folder/workspace paths.
 */
export class WorkspaceScanner implements IWorkspaceScanner {
  /**
   * List workspace folders opened under the given profile user data directory.
   * Sorted by storage directory mtime (most recently modified first).
   */
  async scanWorkspacesForProfile(userDataDir: string): Promise<WorkspaceInfo[]> {
    const workspaceStorageDir = path.join(
      userDataDir,
      'User',
      'workspaceStorage'
    );

    try {
      await fs.access(workspaceStorageDir);
    } catch {
      return [];
    }

    let entries: string[];
    try {
      entries = await fs.readdir(workspaceStorageDir);
    } catch (error) {
      extensionLog.debug(
        `[WorkspaceScanner] Failed to read workspaceStorage for ${userDataDir}: ${extensionLog.formatError(error)}`
      );
      return [];
    }

    const workspaces: WorkspaceInfo[] = [];

    for (const storageHash of entries) {
      if (storageHash.startsWith('.')) {
        continue;
      }

      const storageDir = path.join(workspaceStorageDir, storageHash);
      let stat;
      try {
        stat = await fs.stat(storageDir);
        if (!stat.isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }

      const workspaceJsonPath = path.join(storageDir, 'workspace.json');
      let raw: string;
      try {
        raw = await fs.readFile(workspaceJsonPath, 'utf8');
      } catch {
        continue;
      }

      const folderPath = this.parseWorkspacePath(raw);
      if (!folderPath) {
        continue;
      }

      const existingIndex = workspaces.findIndex((ws) => ws.path === folderPath);
      if (existingIndex >= 0) {
        const existing = workspaces[existingIndex];
        if (
          existing &&
          new Date(stat.mtime).getTime() <=
            new Date(existing.lastModified).getTime()
        ) {
          continue;
        }
        workspaces.splice(existingIndex, 1);
      }

      workspaces.push({
        path: folderPath,
        name: path.basename(folderPath),
        lastModified: stat.mtime.toISOString(),
        storageHash,
      });
    }

    workspaces.sort(
      (a, b) =>
        new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
    );

    return workspaces.slice(0, MAX_WORKSPACES);
  }

  private parseWorkspacePath(raw: string): string | null {
    let parsed: WorkspaceJson;
    try {
      parsed = JSON.parse(raw) as WorkspaceJson;
    } catch (error) {
      extensionLog.debug(
        `[WorkspaceScanner] Invalid workspace.json: ${extensionLog.formatError(error)}`
      );
      return null;
    }

    const uri = parsed.folder ?? parsed.workspace;
    if (typeof uri !== 'string' || uri.length === 0) {
      return null;
    }

    return this.uriToPath(uri);
  }

  private uriToPath(uri: string): string | null {
    if (!uri.startsWith('file://')) {
      return null;
    }

    try {
      return path.normalize(fileURLToPath(uri));
    } catch (error) {
      extensionLog.debug(
        `[WorkspaceScanner] Failed to parse URI ${uri}: ${extensionLog.formatError(error)}`
      );
      return null;
    }
  }
}
