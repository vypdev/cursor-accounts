import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveRecentProjectLaunch } from '../profiles/recentProjectLaunchRouter';

describe('resolveRecentProjectLaunch', () => {
  it('returns noop when project is already open', () => {
    const action = resolveRecentProjectLaunch({
      targetProfileId: 'p1',
      projectPath: '/Users/dev/open-project',
      currentProfileId: 'p1',
      openWorkspacePaths: ['/Users/dev/open-project'],
    });
    assert.equal(action.kind, 'noop');
  });

  it('opens in current window for same account with no open workspace', () => {
    const action = resolveRecentProjectLaunch({
      targetProfileId: 'p1',
      projectPath: '/Users/dev/other-project',
      currentProfileId: 'p1',
      openWorkspacePaths: [],
    });
    assert.deepEqual(action, {
      kind: 'openInCurrentWindow',
      projectPath: '/Users/dev/other-project',
    });
  });

  it('opens in current window for same account when another project is open', () => {
    const action = resolveRecentProjectLaunch({
      targetProfileId: 'p1',
      projectPath: '/Users/dev/other-project',
      currentProfileId: 'p1',
      openWorkspacePaths: ['/Users/dev/open-project'],
    });
    assert.deepEqual(action, {
      kind: 'openInCurrentWindow',
      projectPath: '/Users/dev/other-project',
    });
  });

  it('spawns profile window for different account with empty workspace', () => {
    const action = resolveRecentProjectLaunch({
      targetProfileId: 'p2',
      projectPath: '/Users/dev/work-project',
      currentProfileId: 'p1',
      openWorkspacePaths: [],
    });
    assert.deepEqual(action, {
      kind: 'spawnProfileWindow',
      profileId: 'p2',
      projectPath: '/Users/dev/work-project',
    });
  });

  it('spawns profile window for different account when current has workspace', () => {
    const action = resolveRecentProjectLaunch({
      targetProfileId: 'p2',
      projectPath: '/Users/dev/work-project',
      currentProfileId: 'p1',
      openWorkspacePaths: ['/Users/dev/personal-project'],
    });
    assert.deepEqual(action, {
      kind: 'spawnProfileWindow',
      profileId: 'p2',
      projectPath: '/Users/dev/work-project',
    });
  });

  it('spawns profile window when current profile is undetected', () => {
    const action = resolveRecentProjectLaunch({
      targetProfileId: 'p1',
      projectPath: '/Users/dev/project',
      currentProfileId: null,
      openWorkspacePaths: [],
    });
    assert.deepEqual(action, {
      kind: 'spawnProfileWindow',
      profileId: 'p1',
      projectPath: '/Users/dev/project',
    });
  });
});
