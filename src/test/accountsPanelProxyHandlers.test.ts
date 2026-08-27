import './registerVscodeMock';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import type { Profile } from '@cursor-accounts/types';
import type { ProfileDetector } from '../profiles/profileDetector';
import type { IProxyManager } from '../domain/ports/IProxyManager';
import { initL10nForTests } from '../l10n';
import { AccountsPanelProxyHandlers } from '../ui/accountsPanelProxyHandlers';

const profile = {
  id: 'profile-1',
  displayName: 'Profile 1',
  proxyEnabled: true,
} as Profile;

function setup(overrides: {
  currentProfile?: Profile | null;
  start?: IProxyManager['start'];
  stop?: IProxyManager['stop'];
  installed?: boolean;
  certificatePath?: string | null;
  installCertificate?: () => Promise<{ success: boolean; error?: string }>;
  uninstallCertificate?: () => Promise<{ success: boolean; error?: string }>;
} = {}) {
  const posted: unknown[] = [];
  const refreshes: Array<{ checkCertificate?: boolean } | undefined> = [];
  const handlers = new AccountsPanelProxyHandlers(
    {
      profileDetector: {
        detectCurrentProfile: async () =>
          overrides.currentProfile !== undefined
            ? overrides.currentProfile
            : profile,
      } as unknown as ProfileDetector,
      proxyManager: {
        start: overrides.start ?? (async () => ({ success: true, port: 8080 })),
        stop: overrides.stop ?? (async () => undefined),
        getCertificatePath: async () => overrides.certificatePath ?? null,
        installCertificate:
          overrides.installCertificate ?? (async () => ({ success: true })),
        uninstallCertificate:
          overrides.uninstallCertificate ?? (async () => ({ success: true })),
        checkCertificateInstalled: async () => overrides.installed ?? false,
        getProxyInstallGuide: async () => ({
          platform: 'darwin',
          certAvailable: true,
          title: 'Install',
          intro: 'Intro',
          steps: [],
        }),
        getLogDirectory: () => '/tmp/logs',
      } as never,
    },
    {
      postMessage: async (message) => {
        posted.push(message);
      },
      refreshProxyStatus: async (options) => {
        refreshes.push(options);
      },
    }
  );
  return { handlers, posted, refreshes };
}

describe('AccountsPanelProxyHandlers', () => {
  beforeEach(() => {
    initL10nForTests({
      'commands.proxy.requiresProfile': 'Profile required',
      'commands.proxy.started': 'Started on {port}',
      'commands.proxy.stopped': 'Stopped',
      'commands.proxy.startFailed': 'Start failed: {error}',
      'errors.unknown': 'Unknown',
      'commands.proxy.saveCertificate.failed': 'Save failed: {error}',
      'commands.proxy.saveCertificate.notFound': 'Certificate not found',
    });
  });

  it('starts the current enabled profile and refreshes certificate status', async () => {
    const { handlers, posted, refreshes } = setup();

    await handlers.start();

    assert.deepEqual(posted, [{ type: 'success', message: 'Started on 8080' }]);
    assert.deepEqual(refreshes, [{ checkCertificate: true }]);
  });

  it('reports a missing current profile without starting', async () => {
    const { handlers, posted, refreshes } = setup({ currentProfile: null });

    await handlers.start();

    assert.deepEqual(posted, [{ type: 'error', message: 'Profile required' }]);
    assert.deepEqual(refreshes, []);
  });

  it('reports a failed start and still refreshes certificate status', async () => {
    const { handlers, posted, refreshes } = setup({
      start: async () => ({ success: false, error: 'port busy' }),
    });

    await handlers.start();

    assert.deepEqual(posted, [
      { type: 'error', message: 'Start failed: port busy' },
    ]);
    assert.deepEqual(refreshes, [{ checkCertificate: true }]);
  });

  it('does not stop a profile when the proxy is disabled', async () => {
    let stopCalled = false;
    const { handlers, posted, refreshes } = setup({
      currentProfile: { ...profile, proxyEnabled: false },
      stop: async () => {
        stopCalled = true;
      },
    });

    await handlers.stop();

    assert.equal(stopCalled, false);
    assert.deepEqual(posted, [{ type: 'error', message: 'Profile required' }]);
    assert.deepEqual(refreshes, []);
  });

  it('stops the current profile and refreshes proxy status', async () => {
    let stoppedProfile: string | undefined;
    const { handlers, posted, refreshes } = setup({
      stop: async (profileId) => {
        stoppedProfile = profileId;
      },
    });

    await handlers.stop();

    assert.equal(stoppedProfile, 'profile-1');
    assert.deepEqual(posted, [{ type: 'success', message: 'Stopped' }]);
    assert.deepEqual(refreshes, [undefined]);
  });

  it('publishes the install guide and certificate result', async () => {
    const { handlers, posted, refreshes } = setup();

    await handlers.getInstallGuide();
    await handlers.installCertificate();

    assert.equal(posted[0] && (posted[0] as { type: string }).type, 'proxyInstallGuide');
    assert.deepEqual(posted[1], {
      type: 'certificateInstallResult',
      success: true,
      error: undefined,
    });
    assert.deepEqual(refreshes, [{ checkCertificate: true }]);
  });

  it('keeps a failed install successful when the certificate is already installed', async () => {
    const { handlers, posted } = setup({
      installed: true,
      installCertificate: async () => ({
        success: false,
        error: 'installer failed',
      }),
    });

    await handlers.installCertificate();

    assert.deepEqual(posted, [
      {
        type: 'certificateInstallResult',
        success: true,
        error: undefined,
      },
    ]);
  });

  it('reports an uninstall failure when the certificate remains installed', async () => {
    const { handlers, posted } = setup({
      installed: true,
      uninstallCertificate: async () => ({
        success: false,
        error: 'uninstaller failed',
      }),
    });

    await handlers.uninstallCertificate();

    assert.deepEqual(posted, [
      {
        type: 'certificateUninstallResult',
        success: false,
        error: 'uninstaller failed',
      },
    ]);
  });

  it('reports a missing certificate when saving is requested without a source', async () => {
    const { handlers, posted } = setup();

    await handlers.saveCertificate();

    assert.deepEqual(posted, [
      {
        type: 'error',
        message: 'Save failed: Certificate not found',
      },
    ]);
  });

  it('opens the proxy log directory and traffic output through VS Code commands', async () => {
    const executed: unknown[][] = [];
    const commands = vscode.commands as unknown as {
      executeCommand: (...args: unknown[]) => Promise<unknown>;
    };
    const originalExecuteCommand = commands.executeCommand;
    commands.executeCommand = async (...args) => {
      executed.push(args);
    };

    try {
      const { handlers } = setup();
      await handlers.showLogs();
      await handlers.showTraffic();
    } finally {
      commands.executeCommand = originalExecuteCommand;
    }

    assert.equal(executed[0]?.[0], 'revealFileInOS');
    assert.equal((executed[0]?.[1] as { fsPath: string }).fsPath, '/tmp/logs');
    assert.deepEqual(executed[1], ['cursorAccounts.proxy.showOutput']);
  });
});
