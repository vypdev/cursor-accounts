import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Profile } from '@cursor-accounts/types';
import { ProfileGitHubTokenReader } from '../../github/profileGitHubTokenReader';

describe('ProfileGitHubTokenReader', () => {
  let tempDir: string;
  let reader: ProfileGitHubTokenReader;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(process.cwd(), '.tmp-github-token-')
    );
    reader = new ProfileGitHubTokenReader();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    const tokenDir = path.join(tempDir, 'token');
    await fs.rm(tokenDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('returns not_configured when path is unset', async () => {
    const profile = { githubTokenPath: undefined } as Profile;
    const result = await reader.readToken(profile);
    assert.equal(result.status, 'not_configured');
    assert.equal(result.token, undefined);
  });

  it('reads token from file under home directory', async () => {
    const tokenDir = path.join(tempDir, 'token');
    await fs.mkdir(tokenDir, { recursive: true });
    const tokenFile = path.join(tokenDir, 'github-pat.txt');
    await fs.writeFile(tokenFile, 'ghp_test_token_123\n', 'utf8');

    const profile = { githubTokenPath: tokenFile } as Profile;
    const result = await reader.readToken(profile);
    assert.equal(result.status, 'configured');
    assert.equal(result.token, 'ghp_test_token_123');
  });

  it('returns invalid for paths outside home', async () => {
    const profile = { githubTokenPath: '/etc/passwd' } as Profile;
    const result = await reader.readToken(profile);
    assert.equal(result.status, 'invalid');
  });
});
