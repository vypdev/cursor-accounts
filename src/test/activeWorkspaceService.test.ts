import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isWorkspacePathOpen } from '../services/activeWorkspaceService';

describe('activeWorkspaceService', () => {
  describe('isWorkspacePathOpen', () => {
    it('returns true when project path matches an open path', () => {
      const openPaths = ['/Users/dev/project-a', '/Users/dev/project-b'];

      assert.equal(
        isWorkspacePathOpen('/Users/dev/project-a', openPaths),
        true
      );
    });

    it('returns false when project path is not open', () => {
      const openPaths = ['/Users/dev/project-a'];

      assert.equal(
        isWorkspacePathOpen('/Users/dev/project-b', openPaths),
        false
      );
    });

    it('handles trailing slash differences', () => {
      const openPaths = ['/Users/dev/project-a'];

      assert.equal(
        isWorkspacePathOpen('/Users/dev/project-a/', openPaths),
        true
      );
    });

    it('returns false for empty open path list', () => {
      assert.equal(isWorkspacePathOpen('/Users/dev/project-a', []), false);
    });
  });
});
