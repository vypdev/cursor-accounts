import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceScanner } from '../profiles/workspaceScanner';

describe('WorkspaceScanner', () => {
  let tempDir: string;
  let scanner: WorkspaceScanner;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-workspace-scanner-')
    );
    scanner = new WorkspaceScanner();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty array when workspaceStorage does not exist', async () => {
    const workspaces = await scanner.scanWorkspacesForProfile(tempDir);
    assert.deepEqual(workspaces, []);
  });

  it('reads folder paths from workspace.json entries', async () => {
    const projectDir = path.join(tempDir, 'projects', 'alpha');
    await fs.mkdir(projectDir, { recursive: true });

    const storageRoot = path.join(tempDir, 'User', 'workspaceStorage');
    const hashA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const hashB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const dirA = path.join(storageRoot, hashA);
    const dirB = path.join(storageRoot, hashB);

    await fs.mkdir(dirA, { recursive: true });
    await fs.mkdir(dirB, { recursive: true });

    const folderUri = `file://${projectDir}`;
    await fs.writeFile(
      path.join(dirA, 'workspace.json'),
      JSON.stringify({ folder: folderUri })
    );
    await fs.writeFile(
      path.join(dirB, 'workspace.json'),
      JSON.stringify({ workspace: folderUri })
    );

    const older = new Date('2024-01-01T00:00:00.000Z');
    const newer = new Date('2025-01-01T00:00:00.000Z');
    await fs.utimes(dirA, older, older);
    await fs.utimes(dirB, newer, newer);

    const workspaces = await scanner.scanWorkspacesForProfile(tempDir);

    assert.equal(workspaces.length, 1);
    assert.equal(workspaces[0]?.path, projectDir);
    assert.equal(workspaces[0]?.name, 'alpha');
    assert.equal(workspaces[0]?.storageHash, hashB);
  });

  it('sorts workspaces by storage directory mtime descending', async () => {
    const storageRoot = path.join(tempDir, 'User', 'workspaceStorage');
    const hashOld = '11111111111111111111111111111111';
    const hashNew = '22222222222222222222222222222222';
    const oldDir = path.join(storageRoot, hashOld);
    const newDir = path.join(storageRoot, hashNew);

    await fs.mkdir(oldDir, { recursive: true });
    await fs.mkdir(newDir, { recursive: true });

    const oldProject = path.join(tempDir, 'old-project');
    const newProject = path.join(tempDir, 'new-project');
    await fs.mkdir(oldProject, { recursive: true });
    await fs.mkdir(newProject, { recursive: true });

    await fs.writeFile(
      path.join(oldDir, 'workspace.json'),
      JSON.stringify({ folder: `file://${oldProject}` })
    );
    await fs.writeFile(
      path.join(newDir, 'workspace.json'),
      JSON.stringify({ folder: `file://${newProject}` })
    );

    const older = new Date('2024-01-01T00:00:00.000Z');
    const newer = new Date('2025-06-01T00:00:00.000Z');
    await fs.utimes(oldDir, older, older);
    await fs.utimes(newDir, newer, newer);

    const workspaces = await scanner.scanWorkspacesForProfile(tempDir);

    assert.equal(workspaces.length, 2);
    assert.equal(workspaces[0]?.path, newProject);
    assert.equal(workspaces[1]?.path, oldProject);
  });

  it('skips invalid workspace.json files', async () => {
    const storageRoot = path.join(tempDir, 'User', 'workspaceStorage');
    const hash = 'cccccccccccccccccccccccccccccccc';
    const dir = path.join(storageRoot, hash);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'workspace.json'), '{ invalid json');

    const workspaces = await scanner.scanWorkspacesForProfile(tempDir);
    assert.deepEqual(workspaces, []);
  });
});
