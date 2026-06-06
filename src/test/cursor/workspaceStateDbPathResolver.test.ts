import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import * as vscode from 'vscode';
import {
  findStateVscdbAncestor,
  resolveWorkspaceStateDbFromOpenFolders,
  WorkspaceStateDbPathResolver,
} from '../../cursor/workspaceStateDbPathResolver';

function makeTempWorkspaceStorage(): {
  root: string;
  hash: string;
  dbPath: string;
  cleanup: () => void;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-storage-'));
  const hash = path.join(root, 'abc123hash');
  fs.mkdirSync(hash);
  const dbPath = path.join(hash, 'state.vscdb');
  fs.writeFileSync(dbPath, '');
  fs.writeFileSync(
    path.join(hash, 'workspace.json'),
    JSON.stringify({
      folder: 'file:///tmp/example-project',
    })
  );

  return {
    root,
    hash,
    dbPath,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe('findStateVscdbAncestor', () => {
  it('finds state.vscdb when extension folder is directly under hash', () => {
    const temp = makeTempWorkspaceStorage();
    try {
      const extDir = path.join(temp.hash, 'vypdev.cursor-accounts');
      fs.mkdirSync(extDir);

      assert.equal(findStateVscdbAncestor(extDir), temp.dbPath);
    } finally {
      temp.cleanup();
    }
  });

  it('finds state.vscdb when extension folder is under globalStorage', () => {
    const temp = makeTempWorkspaceStorage();
    try {
      const extDir = path.join(
        temp.hash,
        'globalStorage',
        'vypdev.cursor-accounts'
      );
      fs.mkdirSync(extDir, { recursive: true });

      assert.equal(findStateVscdbAncestor(extDir), temp.dbPath);
    } finally {
      temp.cleanup();
    }
  });

  it('does not climb past workspace hash into workspaceStorage root', () => {
    const temp = makeTempWorkspaceStorage();
    try {
      assert.equal(findStateVscdbAncestor(temp.root), null);
    } finally {
      temp.cleanup();
    }
  });
});

describe('resolveWorkspaceStateDbFromOpenFolders', () => {
  it('matches an open folder path to workspace hash state.vscdb', () => {
    const temp = makeTempWorkspaceStorage();
    try {
      const userDataDir = path.join(temp.root, 'profile');
      fs.mkdirSync(path.join(userDataDir, 'User', 'workspaceStorage'), {
        recursive: true,
      });
      fs.renameSync(
        path.join(temp.root, 'abc123hash'),
        path.join(userDataDir, 'User', 'workspaceStorage', 'abc123hash')
      );

      const resolved = resolveWorkspaceStateDbFromOpenFolders(userDataDir, [
        '/tmp/example-project',
      ]);

      assert.equal(
        resolved,
        path.join(userDataDir, 'User', 'workspaceStorage', 'abc123hash', 'state.vscdb')
      );
    } finally {
      temp.cleanup();
    }
  });
});

describe('WorkspaceStateDbPathResolver', () => {
  it('resolves from direct-under-hash storageUri layout (Cursor)', () => {
    const temp = makeTempWorkspaceStorage();
    try {
      const resolver = new WorkspaceStateDbPathResolver({
        storageUri: vscode.Uri.file(
          path.join(temp.hash, 'vypdev.cursor-accounts')
        ),
        globalStorageUri: vscode.Uri.file(
          '/tmp/profile/User/globalStorage/vypdev.cursor-accounts'
        ),
      });

      assert.equal(resolver.resolve(), temp.dbPath);
    } finally {
      temp.cleanup();
    }
  });

  it('returns null when storageUri is missing', () => {
    const resolver = new WorkspaceStateDbPathResolver({
      storageUri: undefined,
      globalStorageUri: undefined,
    });

    assert.equal(resolver.resolve(), null);
  });

});
