import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Reads the current Git branch from a repository's `.git/HEAD`.
 */
export class GitBranchDetector {
  async getCurrentBranch(repoPath: string): Promise<string | undefined> {
    try {
      const gitHeadPath = path.join(repoPath, '.git', 'HEAD');
      const headContent = await fs.readFile(gitHeadPath, 'utf-8');
      const trimmed = headContent.trim();

      const refMatch = trimmed.match(/^ref: refs\/heads\/(.+)$/);
      if (refMatch) {
        return refMatch[1];
      }

      if (/^[0-9a-f]{40}$/i.test(trimmed)) {
        return `detached@${trimmed.slice(0, 7)}`;
      }

      return undefined;
    } catch {
      return undefined;
    }
  }
}
