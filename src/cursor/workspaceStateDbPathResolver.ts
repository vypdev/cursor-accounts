import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type * as vscode from 'vscode';
import type { IWorkspaceStateDbPathResolver } from '../domain/ports/IWorkspaceStateDbPathResolver';
import { getOpenWorkspacePaths } from '../services/activeWorkspaceService';

/**
 * Walk up from the extension workspace storage folder until `state.vscdb` is found.
 * Stops before climbing out of a workspace hash directory into `workspaceStorage/`.
 */
export function findStateVscdbAncestor(startDir: string): string | null {
  let dir = path.normalize(startDir);

  while (true) {
    const candidate = path.join(dir, 'state.vscdb');
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }

    if (path.basename(parent) === 'workspaceStorage') {
      return null;
    }

    dir = parent;
  }
}

function parseWorkspaceFolderPath(workspaceJsonRaw: string): string | null {
  try {
    const parsed = JSON.parse(workspaceJsonRaw) as {
      folder?: string;
      workspace?: string;
    };
    const uri = parsed.folder ?? parsed.workspace;
    if (typeof uri !== 'string' || !uri.startsWith('file://')) {
      return null;
    }
    return path.normalize(fileURLToPath(uri));
  } catch {
    return null;
  }
}

/**
 * Match open workspace folders to `workspaceStorage/{hash}/state.vscdb`.
 */
export function resolveWorkspaceStateDbFromOpenFolders(
  userDataDir: string,
  openPaths: string[]
): string | null {
  if (openPaths.length === 0) {
    return null;
  }

  const workspaceStorageRoot = path.join(userDataDir, 'User', 'workspaceStorage');
  if (!fs.existsSync(workspaceStorageRoot)) {
    return null;
  }

  const normalizedOpen = new Set(openPaths.map((p) => path.normalize(p)));

  let entries: string[];
  try {
    entries = fs.readdirSync(workspaceStorageRoot);
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (entry.startsWith('.')) {
      continue;
    }

    const hashDir = path.join(workspaceStorageRoot, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(hashDir);
      if (!stat.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    const workspaceJsonPath = path.join(hashDir, 'workspace.json');
    if (!fs.existsSync(workspaceJsonPath)) {
      continue;
    }

    let folderPath: string | null;
    try {
      folderPath = parseWorkspaceFolderPath(
        fs.readFileSync(workspaceJsonPath, 'utf8')
      );
    } catch {
      continue;
    }

    if (!folderPath || !normalizedOpen.has(folderPath)) {
      continue;
    }

    const dbPath = path.join(hashDir, 'state.vscdb');
    if (fs.existsSync(dbPath)) {
      return dbPath;
    }
  }

  return null;
}

/**
 * Derives workspace `state.vscdb` from `ExtensionContext.storageUri` or open folders.
 *
 * Cursor may store extension state as any of:
 * - `.../workspaceStorage/{hash}/vypdev.cursor-accounts`
 * - `.../workspaceStorage/{hash}/globalStorage/vypdev.cursor-accounts`
 * - `.../workspaceStorage/{hash}/workspaceStorage/vypdev.cursor-accounts`
 */
export interface WorkspaceStateDbContext {
  storageUri: vscode.Uri | undefined;
  globalStorageUri: vscode.Uri | undefined;
}

export class WorkspaceStateDbPathResolver implements IWorkspaceStateDbPathResolver {
  constructor(private readonly context: WorkspaceStateDbContext) {}

  resolve(): string | null {
    const storageUri = this.context.storageUri;
    if (storageUri) {
      const fromStorageUri = findStateVscdbAncestor(
        path.dirname(storageUri.fsPath)
      );
      if (fromStorageUri) {
        return fromStorageUri;
      }
    }

    const userDataDir = this.deriveUserDataDir();
    if (!userDataDir) {
      return null;
    }

    return resolveWorkspaceStateDbFromOpenFolders(
      userDataDir,
      getOpenWorkspacePaths()
    );
  }

  private deriveUserDataDir(): string | null {
    const globalStorageUri = this.context.globalStorageUri;
    if (!globalStorageUri) {
      return null;
    }

    const userDir = path.dirname(path.dirname(globalStorageUri.fsPath));
    return path.dirname(userDir);
  }
}
