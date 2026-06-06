import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface WorkspaceGitInfo {
  repositoryPath: string;
  branchName: string | null;
}

/**
 * Extracts git repository path and branch from a workspace directory.
 */
export async function extractGitInfo(
  workspacePath: string
): Promise<WorkspaceGitInfo | null> {
  try {
    const gitDir = path.join(workspacePath, '.git');

    try {
      await fs.access(gitDir);
    } catch {
      return {
        repositoryPath: workspacePath,
        branchName: null,
      };
    }

    const headPath = path.join(gitDir, 'HEAD');
    const headContent = await fs.readFile(headPath, 'utf8');
    const match = /ref: refs\/heads\/(.+)/.exec(headContent.trim());
    const branchName = match?.[1] ?? null;

    return {
      repositoryPath: workspacePath,
      branchName,
    };
  } catch {
    return {
      repositoryPath: workspacePath,
      branchName: null,
    };
  }
}
