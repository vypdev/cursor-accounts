import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractGitInfo } from '../../../utils/gitWorkspaceExtractor';

describe('extractGitInfo', () => {
  it('returns null branch when .git does not exist', async () => {
    const info = await extractGitInfo('/non-git-workspace');
    assert.equal(info?.repositoryPath, '/non-git-workspace');
    assert.equal(info?.branchName, null);
  });
});
