import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Profile, ProfileGithubTokenStatus } from '@cursor-accounts/types';

export interface TokenReadResult {
  status: ProfileGithubTokenStatus;
  token?: string;
}

/**
 * Reads a GitHub PAT from a user-configured file path on a profile.
 */
export class ProfileGitHubTokenReader {
  resolveTokenStatus(profile: Profile): ProfileGithubTokenStatus {
    const tokenPath = profile.githubTokenPath?.trim();
    if (!tokenPath) {
      return 'not_configured';
    }
    return 'configured';
  }

  async readToken(profile: Profile): Promise<TokenReadResult> {
    const tokenPath = profile.githubTokenPath?.trim();
    if (!tokenPath) {
      return { status: 'not_configured' };
    }

    const validation = this.validateTokenPath(tokenPath);
    if (!validation.valid) {
      return { status: 'invalid' };
    }

    try {
      const raw = await fs.readFile(tokenPath, 'utf8');
      const token = raw.trim().split(/\r?\n/)[0]?.trim();
      if (!token) {
        return { status: 'invalid' };
      }
      return { status: 'configured', token };
    } catch {
      return { status: 'invalid' };
    }
  }

  validateTokenPath(tokenPath: string): { valid: boolean } {
    if (!path.isAbsolute(tokenPath)) {
      return { valid: false };
    }

    const normalized = path.normalize(path.resolve(tokenPath));
    const home = path.normalize(os.homedir());

    if (!normalized.startsWith(home)) {
      return { valid: false };
    }

    return { valid: true };
  }
}
