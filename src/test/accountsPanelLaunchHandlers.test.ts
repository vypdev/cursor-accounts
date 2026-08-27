import './registerVscodeMock';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import { initL10nForTests } from '../l10n';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileLauncher } from '../domain/ports/IProfileLauncher';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { ProfileWorkspaceService } from '../application/services/profileWorkspaceService';
import { AccountsPanelLaunchHandlers } from '../ui/accountsPanelLaunchHandlers';

const PROFILE = {
  id: 'p1',
  email: 'user@example.com',
  slug: 'user',
  displayName: 'User',
  userDataDir: '/home/user/.cursor-user',
  created: '2024-01-01T00:00:00.000Z',
};

function createHandlers(overrides: {
  launch?: IProfileLauncher['launch'];
  getMostRecentWorkspace?: ProfileWorkspaceService['getMostRecentWorkspace'];
} = {}) {
  const messages: Array<{ type: string; message: string }> = [];
  let refreshCount = 0;
  let refreshInstancesCount = 0;
  const handlers = new AccountsPanelLaunchHandlers(
    {
      profileManager: {
        getProfile: async () => PROFILE,
      } as unknown as IProfileManager,
      profileLauncher: {
        launch:
          overrides.launch ??
          (async (...args) => ({ success: true, pid: 1, args })),
      } as unknown as IProfileLauncher,
      profileDetector: {
        detectCurrentProfile: async () => PROFILE,
      } as unknown as IProfileDetector,
      profileWorkspaceService: {
        getMostRecentWorkspace:
          overrides.getMostRecentWorkspace ?? (async () => undefined),
      } as unknown as ProfileWorkspaceService,
    },
    {
      postMessage: async (message) => {
        messages.push(message as { type: string; message: string });
      },
      refresh: async () => {
        refreshCount += 1;
      },
      refreshInstances: async () => {
        refreshInstancesCount += 1;
      },
    }
  );

  return {
    handlers,
    messages,
    getRefreshCount: () => refreshCount,
    getRefreshInstancesCount: () => refreshInstancesCount,
  };
}

describe('AccountsPanelLaunchHandlers', () => {
  beforeEach(() => {
    initL10nForTests({
      'panel.launched': 'Launched {name}',
      'panel.launchedWithProject': 'Launched {name} with project {project}',
      'panel.profileFallback': 'Profile',
      'errors.failedLaunchProfile': 'Failed to launch',
    });
    (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = [];
    (vscode.workspace as { workspaceFile?: unknown }).workspaceFile = undefined;
  });

  it('launches the most recent workspace and publishes success', async () => {
    const launchCalls: unknown[][] = [];
    const { handlers, messages, getRefreshCount, getRefreshInstancesCount } =
      createHandlers({
        launch: async (...args) => {
          launchCalls.push(args);
          return { success: true, pid: 42 };
        },
        getMostRecentWorkspace: async () => '/workspace/recent-project',
      });

    await handlers.launch('p1');

    assert.deepEqual(launchCalls, [
      ['p1', { projectPath: '/workspace/recent-project' }],
    ]);
    assert.deepEqual(messages, [
      { type: 'success', message: 'Launched User with project recent-project' },
    ]);
    assert.equal(getRefreshCount(), 1);
    assert.equal(getRefreshInstancesCount(), 1);
  });

  it('publishes a launch error without refreshing', async () => {
    const { handlers, messages, getRefreshCount } = createHandlers({
      launch: async () => ({ success: false, error: 'Executable unavailable' }),
    });

    await handlers.launch('p1');

    assert.deepEqual(messages, [
      { type: 'error', message: 'Executable unavailable' },
    ]);
    assert.equal(getRefreshCount(), 0);
  });

  it('ignores a concurrent launch for the same profile', async () => {
    let resolveLaunch: ((result: { success: boolean }) => void) | undefined;
    let launchCount = 0;
    const { handlers } = createHandlers({
      launch: async () => {
        launchCount += 1;
        return new Promise((resolve) => {
          resolveLaunch = resolve;
        });
      },
    });

    const first = handlers.launch('p1');
    await new Promise<void>((resolve) => setImmediate(resolve));
    await handlers.launch('p1');
    assert.equal(launchCount, 1);

    resolveLaunch?.({ success: true });
    await first;
  });
});
