import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { GitBranchDetector } from '../../modelEfficiency/gitBranchDetector';

describe('GitBranchDetector', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('returns branch name from refs/heads', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-branch-'));
    await fs.mkdir(path.join(tempDir, '.git'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, '.git', 'HEAD'),
      'ref: refs/heads/feature/auth\n',
      'utf-8'
    );

    const detector = new GitBranchDetector();
    const branch = await detector.getCurrentBranch(tempDir);
    assert.equal(branch, 'feature/auth');
  });

  it('returns detached HEAD label for commit hash', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-branch-'));
    await fs.mkdir(path.join(tempDir, '.git'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, '.git', 'HEAD'),
      'abcdef0123456789abcdef0123456789abcdef01\n',
      'utf-8'
    );

    const detector = new GitBranchDetector();
    const branch = await detector.getCurrentBranch(tempDir);
    assert.equal(branch, 'detached@abcdef0');
  });

  it('returns undefined when .git is missing', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-branch-'));
    const detector = new GitBranchDetector();
    const branch = await detector.getCurrentBranch(tempDir);
    assert.equal(branch, undefined);
  });
});
