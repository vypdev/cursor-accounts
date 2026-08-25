import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vscode from 'vscode';
import type { QuotaUsage } from '../domain';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import { StatusBarManager } from '../ui/statusBarManager';
import type { Profile } from '../profiles/types';

interface FakeStatusBarItem {
  text: string;
  tooltip: unknown;
  command: string;
  name: string;
  backgroundColor: vscode.ThemeColor | undefined;
  showCalls: number;
  hideCalls: number;
  show(): void;
  hide(): void;
  dispose(): void;
}

interface FakeContext {
  context: vscode.ExtensionContext;
  state: Map<string, unknown>;
  item: FakeStatusBarItem;
}

function profile(): Profile {
  return {
    id: 'profile-a',
    email: 'profile@example.com',
    slug: 'profile-a',
    displayName: 'Work',
    userDataDir: '/tmp/profile-a',
    created: '2026-01-01T00:00:00.000Z',
  };
}

function usage(): QuotaUsage {
  return {
    totalPercentUsed: 40,
    autoPercentUsed: 20,
    apiPercentUsed: 60,
    totalSpend: 4000,
    includedSpend: 1000,
    remaining: 6000,
    limit: 10000,
    billingCycleStart: '2026-01-01T00:00:00.000Z',
    billingCycleEnd: '2026-02-01T00:00:00.000Z',
    fetchedAt: 1,
  };
}

function createContext(): FakeContext {
  const state = new Map<string, unknown>();
  const item: FakeStatusBarItem = {
    text: '',
    tooltip: '',
    command: '',
    name: '',
    backgroundColor: undefined,
    showCalls: 0,
    hideCalls: 0,
    show() {
      this.showCalls += 1;
    },
    hide() {
      this.hideCalls += 1;
    },
    dispose() {
      return undefined;
    },
  };

  const context = {
    globalState: {
      get: <T>(key: string): T | undefined => state.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        state.set(key, value);
      },
    },
    subscriptions: [] as Array<{ dispose(): void }>,
  } as unknown as vscode.ExtensionContext;

  return { context, state, item };
}

function detector(
  detect: () => Promise<Profile | null>
): IProfileDetector {
  return {
    detectCurrentProfile: detect,
    getCurrentUserDataDir: () => '',
    getDefaultCursorUserDataDir: () => '',
    isDefaultProfile: () => false,
    clearCache: () => undefined,
    getProfileDescription: async () => '',
  };
}

async function withConfiguration<T>(
  values: Record<string, unknown>,
  action: (context: FakeContext) => Promise<T>
): Promise<T> {
  const vscodeMock = vscode as unknown as {
    window: { createStatusBarItem: typeof vscode.window.createStatusBarItem };
    workspace: {
      getConfiguration: typeof vscode.workspace.getConfiguration;
    };
  };
  const originalCreate = vscodeMock.window.createStatusBarItem;
  const originalConfiguration = vscodeMock.workspace.getConfiguration;
  const context = createContext();

  vscodeMock.window.createStatusBarItem = (() =>
    context.item) as unknown as typeof vscode.window.createStatusBarItem;
  vscodeMock.workspace.getConfiguration = (() =>
    ({
      get: <T>(key: string, defaultValue?: T): T | undefined =>
        (key in values ? values[key] : defaultValue) as T | undefined,
    })) as typeof vscode.workspace.getConfiguration;

  try {
    return await action(context);
  } finally {
    vscodeMock.window.createStatusBarItem = originalCreate;
    vscodeMock.workspace.getConfiguration = originalConfiguration;
  }
}

const defaultConfiguration = {
  'refresh.enabled': true,
  'refresh.intervalSeconds': 60,
  'statusBar.showIncluded': true,
  'statusBar.showTotal': true,
  'statusBar.showAccountEmail': false,
  'profiles.showProfileInStatusBar': true,
};

describe('StatusBarManager', () => {
  it('shows the account-selection state when no profile is detected', async () => {
    await withConfiguration(defaultConfiguration, async ({ context, item }) => {
      const manager = new StatusBarManager(
        context,
        detector(async () => null)
      );

      await manager.updateProfileIndicator();

      assert.equal(item.text, '$(account) Select account');
      assert.equal(item.tooltip, 'Open Cursor Accounts to choose a profile');
      assert.ok(item.showCalls > 0);
    });
  });

  it('renders loading and cached quota states for the active profile', async () => {
    await withConfiguration(defaultConfiguration, async ({ context, item, state }) => {
      const manager = new StatusBarManager(
        context,
        detector(async () => profile())
      );

      await manager.updateProfileIndicator();
      manager.showLoading();
      assert.match(item.text, /Usage…/);

      const snapshot = usage();
      manager.render(snapshot);
      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.match(item.text, /\$|%/);
      assert.equal(state.get('lastQuota'), snapshot);
      assert.ok(item.tooltip instanceof vscode.MarkdownString);
      assert.ok(item.showCalls > 0);
    });
  });

  it('renders quota errors with the warning background', async () => {
    await withConfiguration(defaultConfiguration, async ({ context, item }) => {
      const manager = new StatusBarManager(
        context,
        detector(async () => profile())
      );

      await manager.updateProfileIndicator();
      manager.showError('Quota service unavailable');

      assert.match(item.text, /Quota unavailable/);
      assert.equal(item.tooltip, 'Quota service unavailable');
      assert.equal(item.backgroundColor?.id, 'statusBarItem.warningBackground');
    });
  });

  it('shows only the profile when quota display is disabled', async () => {
    await withConfiguration(
      {
        ...defaultConfiguration,
        'statusBar.showIncluded': false,
        'statusBar.showTotal': false,
        'profiles.showProfileInStatusBar': true,
      },
      async ({ context, item }) => {
        const manager = new StatusBarManager(
          context,
          detector(async () => profile())
        );

        await manager.updateProfileIndicator();

        assert.equal(item.text, '$(account) Work');
        assert.match(String(item.tooltip), /profile@example.com/);
        assert.ok(item.showCalls > 0);
      }
    );
  });

  it('hides the item when both quota and profile display are disabled', async () => {
    await withConfiguration(
      {
        ...defaultConfiguration,
        'statusBar.showIncluded': false,
        'statusBar.showTotal': false,
        'profiles.showProfileInStatusBar': false,
      },
      async ({ context, item }) => {
        const manager = new StatusBarManager(
          context,
          detector(async () => profile())
        );

        await manager.updateProfileIndicator();

        assert.ok(item.hideCalls > 0);
      }
    );
  });

  it('clears the active profile when detection fails', async () => {
    await withConfiguration(defaultConfiguration, async ({ context, item }) => {
      const manager = new StatusBarManager(
        context,
        detector(async () => {
          throw new Error('detector unavailable');
        })
      );

      await manager.updateProfileIndicator();

      assert.equal(item.text, '$(account) Select account');
      assert.ok(item.showCalls > 0);
    });
  });
});
