import * as vscode from 'vscode';
import { pathsEqual } from '../utils/pathUtils';

/** Paths of folders and workspace files open in the active Cursor window. */
export function getOpenWorkspacePaths(): string[] {
  const paths: string[] = [];

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    paths.push(folder.uri.fsPath);
  }

  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile) {
    paths.push(workspaceFile.fsPath);
  }

  return paths;
}

/** Whether the active window has at least one folder or workspace file open. */
export function hasActiveWorkspace(): boolean {
  return getOpenWorkspacePaths().length > 0;
}

/** Whether a project path is already open in the active window. */
export function isWorkspacePathOpen(
  projectPath: string,
  openPaths?: string[]
): boolean {
  const open = openPaths ?? getOpenWorkspacePaths();
  return open.some((p) => pathsEqual(p, projectPath));
}
