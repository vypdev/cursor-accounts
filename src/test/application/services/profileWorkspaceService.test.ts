import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile, WorkspaceInfo } from '@cursor-accounts/types';
import type { IProfileReader } from '../../../domain/ports/IProfileReader';
import type { IWorkspaceScanner } from '../../../domain/ports/IWorkspaceScanner';
import { ProfileWorkspaceService } from '../../../application/services/profileWorkspaceService';

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

class StubProfileReader implements IProfileReader {
  constructor(private readonly profiles: Profile[]) {}

  getProfiles(): Promise<Profile[]> {
    return Promise.resolve(this.profiles);
  }

  getProfile(id: string): Promise<Profile | undefined> {
    return Promise.resolve(this.profiles.find((profile) => profile.id === id));
  }

  findProfileByEmail(): Promise<Profile | undefined> {
    return Promise.resolve(undefined);
  }

  findProfileByPath(): Promise<Profile | undefined> {
    return Promise.resolve(undefined);
  }
}

class StubWorkspaceScanner implements IWorkspaceScanner {
  readonly calls: string[] = [];

  constructor(private readonly workspaces: Map<string, WorkspaceInfo[]>) {}

  scanWorkspacesForProfile(userDataDir: string): Promise<WorkspaceInfo[]> {
    this.calls.push(userDataDir);
    return Promise.resolve(this.workspaces.get(userDataDir) ?? []);
  }
}

describe('ProfileWorkspaceService', () => {
  it('combines every saved profile with its scanned workspaces', async () => {
    const profiles = [profile('one'), profile('two')];
    const scanner = new StubWorkspaceScanner(
      new Map([
        [profiles[0]!.userDataDir, [workspace('/projects/one', 'one-hash')]],
        [profiles[1]!.userDataDir, []],
      ])
    );
    const service = new ProfileWorkspaceService(
      new StubProfileReader(profiles),
      scanner
    );

    const result = await service.getProfilesWithWorkspaces();

    assert.deepEqual(result, [
      { ...profiles[0], workspaces: [workspace('/projects/one', 'one-hash')] },
      { ...profiles[1], workspaces: [] },
    ]);
    assert.deepEqual(scanner.calls, ['/profiles/one', '/profiles/two']);
  });

  it('returns no workspaces and does not scan an unknown profile', async () => {
    const scanner = new StubWorkspaceScanner(new Map());
    const service = new ProfileWorkspaceService(
      new StubProfileReader([profile('known')]),
      scanner
    );

    assert.deepEqual(await service.getWorkspacesForProfile('missing'), []);
    assert.equal(await service.getMostRecentWorkspace('missing'), undefined);
    assert.deepEqual(scanner.calls, []);
  });

  it('delegates existing profiles and returns the first workspace path', async () => {
    const currentProfile = profile('current');
    const workspaces = [
      workspace('/projects/newest', 'newest'),
      workspace('/projects/older', 'older'),
    ];
    const scanner = new StubWorkspaceScanner(
      new Map([[currentProfile.userDataDir, workspaces]])
    );
    const service = new ProfileWorkspaceService(
      new StubProfileReader([currentProfile]),
      scanner
    );

    assert.deepEqual(
      await service.getWorkspacesForProfile(currentProfile.id),
      workspaces
    );
    assert.equal(
      await service.getMostRecentWorkspace(currentProfile.id),
      '/projects/newest'
    );
    assert.deepEqual(scanner.calls, [
      '/profiles/current',
      '/profiles/current',
    ]);
  });
});
