import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { GitRemoteResolver } from '../../github/gitRemoteResolver';

describe('GitRemoteResolver', () => {
  let tempDir: string;
  let resolver: GitRemoteResolver;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-git-remote-')
    );
    resolver = new GitRemoteResolver();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('parses HTTPS GitHub origin URLs', () => {
    const ref = resolver.parseGitHubUrl(
      'https://github.com/vypdev/cursor-accounts.git'
    );
    assert.ok(ref);
    assert.equal(ref.owner, 'vypdev');
    assert.equal(ref.repo, 'cursor-accounts');
    assert.equal(ref.fullName, 'vypdev/cursor-accounts');
  });

  it('parses SSH GitHub origin URLs', () => {
    const ref = resolver.parseGitHubUrl(
      'git@github.com:octo/hello-world.git'
    );
    assert.ok(ref);
    assert.equal(ref.owner, 'octo');
    assert.equal(ref.repo, 'hello-world');
  });

  it('returns null for non-GitHub hosts', () => {
    assert.equal(
      resolver.parseGitHubUrl('https://gitlab.com/group/project.git'),
      null
    );
  });

  it('reads origin url from git config', () => {
    const config = `[remote "origin"]
\turl = https://github.com/foo/bar.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
`;
    assert.equal(
      resolver.parseOriginUrl(config),
      'https://github.com/foo/bar.git'
    );
  });

  it('resolves repo from workspace with .git directory', async () => {
    const projectDir = path.join(tempDir, 'my-project');
    await fs.mkdir(path.join(projectDir, '.git'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, '.git', 'config'),
      `[remote "origin"]
url = https://github.com/acme/widget.git
`
    );

    const ref = await resolver.resolveFromWorkspacePath(projectDir);
    assert.ok(ref);
    assert.equal(ref.fullName, 'acme/widget');
  });

  it('returns null when workspace is not a git repo', async () => {
    const projectDir = path.join(tempDir, 'plain-folder');
    await fs.mkdir(projectDir, { recursive: true });
    const ref = await resolver.resolveFromWorkspacePath(projectDir);
    assert.equal(ref, null);
  });
});
