import * as fs from 'fs/promises';
import * as path from 'path';
import type { GitHubRepoRef } from '@cursor-accounts/types';

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

/**
 * Resolves a workspace folder path to a GitHub owner/repo from git remotes.
 */
export class GitRemoteResolver {
  async resolveFromWorkspacePath(
    workspacePath: string
  ): Promise<GitHubRepoRef | null> {
    const roots = await this.collectGitRoots(workspacePath);
    for (const root of roots) {
      const ref = await this.resolveFromGitRoot(root);
      if (ref) {
        return ref;
      }
    }
    return null;
  }

  private async collectGitRoots(workspacePath: string): Promise<string[]> {
    if (workspacePath.endsWith('.code-workspace')) {
      return this.rootsFromMultiRootWorkspace(workspacePath);
    }

    const root = await this.findGitRoot(workspacePath);
    return root ? [root] : [];
  }

  private async rootsFromMultiRootWorkspace(
    workspaceFile: string
  ): Promise<string[]> {
    try {
      const raw = await fs.readFile(workspaceFile, 'utf8');
      const parsed = JSON.parse(raw) as { folders?: Array<{ path?: string }> };
      const folders = parsed.folders ?? [];
      const workspaceDir = path.dirname(workspaceFile);
      const roots: string[] = [];

      for (const folder of folders) {
        if (typeof folder.path !== 'string' || folder.path.length === 0) {
          continue;
        }
        const folderPath = path.isAbsolute(folder.path)
          ? folder.path
          : path.join(workspaceDir, folder.path);
        const root = await this.findGitRoot(folderPath);
        if (root) {
          roots.push(root);
        }
      }

      return roots;
    } catch {
      return [];
    }
  }

  private async findGitRoot(startPath: string): Promise<string | null> {
    let current = path.resolve(startPath);

    for (let depth = 0; depth < 32; depth++) {
      const gitDir = path.join(current, '.git');
      try {
        const stat = await fs.stat(gitDir);
        if (stat.isDirectory() || stat.isFile()) {
          return current;
        }
      } catch {
        // continue upward
      }

      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    return null;
  }

  private async resolveFromGitRoot(gitRoot: string): Promise<GitHubRepoRef | null> {
    const configPath = path.join(gitRoot, '.git', 'config');
    let raw: string;
    try {
      raw = await fs.readFile(configPath, 'utf8');
    } catch {
      return null;
    }

    const originUrl = this.parseOriginUrl(raw);
    if (!originUrl) {
      return null;
    }

    return this.parseGitHubUrl(originUrl);
  }

  parseOriginUrl(configContent: string): string | null {
    const lines = configContent.split(/\r?\n/);
    let inOrigin = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '[remote "origin"]') {
        inOrigin = true;
        continue;
      }
      if (inOrigin && trimmed.startsWith('[')) {
        break;
      }
      if (inOrigin && trimmed.startsWith('url =')) {
        return trimmed.slice('url ='.length).trim();
      }
    }

    return null;
  }

  parseGitHubUrl(remoteUrl: string): GitHubRepoRef | null {
    const sshMatch = /^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/i.exec(
      remoteUrl.trim()
    );
    if (sshMatch) {
      const host = sshMatch[1]?.toLowerCase() ?? '';
      if (!GITHUB_HOSTS.has(host)) {
        return null;
      }
      const owner = sshMatch[2] ?? '';
      const repo = (sshMatch[3] ?? '').replace(/\.git$/i, '');
      return this.buildRef(owner, repo);
    }

    try {
      const url = new URL(remoteUrl.trim());
      const host = url.hostname.toLowerCase();
      if (!GITHUB_HOSTS.has(host)) {
        return null;
      }

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2) {
        return null;
      }

      const owner = parts[0] ?? '';
      const repo = (parts[1] ?? '').replace(/\.git$/i, '');
      return this.buildRef(owner, repo);
    } catch {
      return null;
    }
  }

  private buildRef(owner: string, repo: string): GitHubRepoRef | null {
    if (!owner || !repo) {
      return null;
    }

    return {
      owner,
      repo,
      apiBase: 'https://api.github.com',
      fullName: `${owner}/${repo}`,
    };
  }
}
