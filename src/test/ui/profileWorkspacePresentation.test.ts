import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  InstanceInfoMap,
  Profile,
  ProfileWithWorkspaces,
  WorkspaceInfo,
} from '@cursor-accounts/types';
import { buildProfileWorkspaceMap } from '../../ui/presentation/profileWorkspacePresentation';

function profile(id: string): Profile {
  return {
    id,
    email: `${id}@example.com`,
    slug: id,
    displayName: id,
    userDataDir: `/profiles/${id}`,
    created: '2026-01-01T00:00:00.000Z',
  };
}

function workspace(path: string, storageHash: string): WorkspaceInfo {
  return {
    path,
    name: path.split('/').pop() ?? path,
    lastModified: '2026-01-02T00:00:00.000Z',
    storageHash,
  };
}

function instance(
  profileId: string,
  projectPath?: string
): InstanceInfoMap[string] {
  return {
    profileId,
    pid: 123,
    userDataDir: `/profiles/${profileId}`,
    projectPath,
    detectedAt: 1,
  };
}

describe('buildProfileWorkspaceMap', () => {
  it('marks active-window and running-instance projects independently', () => {
    const current = profile('current');
    const other = profile('other');
    const currentWorkspaces: WorkspaceInfo[] = [
      workspace('/projects/open', 'open'),
      workspace('/projects/running', 'running'),
      workspace('/projects/closed', 'closed'),
    ];
    const profiles: ProfileWithWorkspaces[] = [
      { ...current, workspaces: currentWorkspaces },
      { ...other, workspaces: [workspace('/projects/other', 'other')] },
    ];
    const runningInstances: InstanceInfoMap = {
      currentInstance: instance('current', '/projects/running'),
      otherInstance: instance('other', '/projects/other'),
    };

    const result = buildProfileWorkspaceMap(
      profiles,
      current,
      ['/projects/open/'],
      runningInstances
    );

    assert.deepEqual(result, {
      current: [
        { ...currentWorkspaces[0], isOpenInSession: true },
        { ...currentWorkspaces[1], isOpenInSession: true },
        { ...currentWorkspaces[2], isOpenInSession: false },
      ],
      other: [{ ...workspace('/projects/other', 'other'), isOpenInSession: true }],
    });
  });

  it('does not mark another profile open from the active window', () => {
    const current = profile('current');
    const other = profile('other');

    const result = buildProfileWorkspaceMap(
      [
        { ...current, workspaces: [] },
        { ...other, workspaces: [workspace('/projects/shared', 'shared')] },
      ],
      current,
      ['/projects/shared'],
      {}
    );

    assert.equal(result.other?.[0]?.isOpenInSession, false);
  });

  it('returns an empty projection for profiles without workspaces', () => {
    const current = profile('current');

    assert.deepEqual(
      buildProfileWorkspaceMap(
        [{ ...current, workspaces: [] }],
        null,
        ['/projects/anything'],
        {}
      ),
      { current: [] }
    );
  });
});
