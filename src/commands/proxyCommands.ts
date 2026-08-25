import * as vscode from 'vscode';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProxyCertificate } from '../domain/ports/IProxyCertificate';
import type { IProxyLifecycle } from '../domain/ports/IProxyLifecycle';
import type { IProxyOutput } from '../domain/ports/IProxyOutput';
import type { IProxyStatus } from '../domain/ports/IProxyStatus';
import { isProfileProxyEnabled } from '@cursor-accounts/types';
import { t } from '../l10n';
import { saveCaCertificateAs } from '../proxy/saveCaCertificate';

type DetectedProfile = NonNullable<
  Awaited<ReturnType<IProfileDetector['detectCurrentProfile']>>
>;

type ProxyCommandManager = IProxyLifecycle &
  IProxyStatus &
  IProxyCertificate &
  IProxyOutput;

type ProxyCommandHandler = () => Promise<void> | void;

async function getEnabledCurrentProfile(
  profileDetector: IProfileDetector
): Promise<DetectedProfile | null> {
  const currentProfile = await profileDetector.detectCurrentProfile();
  if (!currentProfile || !isProfileProxyEnabled(currentProfile)) {
    vscode.window.showWarningMessage(t('commands.proxy.requiresProfile'));
    return null;
  }
  return currentProfile;
}

export function registerProxyCommands(
  context: vscode.ExtensionContext,
  proxyManager: ProxyCommandManager,
  profileDetector: IProfileDetector,
  onStatusChanged?: () => void
): void {
  proxyManager.onStatusChange(() => {
    onStatusChanged?.();
  });

  registerStartCommand(context, proxyManager, profileDetector);
  registerStopCommand(context, proxyManager, profileDetector);
  registerShowLogsCommand(context, proxyManager);
  registerClearLogsCommand(context, proxyManager);
  registerShowOutputCommand(context, proxyManager, profileDetector);
  registerOutputCommands(context, proxyManager);
  registerSaveCertificateCommand(context, proxyManager);
}

function registerStartCommand(
  context: vscode.ExtensionContext,
  proxyManager: ProxyCommandManager,
  profileDetector: IProfileDetector
): void {
  addCommand(context, 'cursorAccounts.proxy.start', async () => {
    const currentProfile = await getEnabledCurrentProfile(profileDetector);
    if (!currentProfile) return;

    const result = await proxyManager.start(currentProfile.id);
    if (result.success) {
      vscode.window.showInformationMessage(
        t('commands.proxy.started', { port: String(result.port ?? '') })
      );
      return;
    }
    vscode.window.showErrorMessage(
      t('commands.proxy.startFailed', {
        error: result.error ?? t('errors.unknown'),
      })
    );
  });
}

function registerStopCommand(
  context: vscode.ExtensionContext,
  proxyManager: ProxyCommandManager,
  profileDetector: IProfileDetector
): void {
  addCommand(context, 'cursorAccounts.proxy.stop', async () => {
    const currentProfile = await getEnabledCurrentProfile(profileDetector);
    if (!currentProfile) return;

    await proxyManager.stop(currentProfile.id);
    vscode.window.showInformationMessage(t('commands.proxy.stopped'));
  });
}

function registerShowLogsCommand(
  context: vscode.ExtensionContext,
  proxyManager: ProxyCommandManager
): void {
  addCommand(context, 'cursorAccounts.proxy.showLogs', async () => {
    await vscode.commands.executeCommand(
      'revealFileInOS',
      vscode.Uri.file(proxyManager.getLogDirectory())
    );
  });
}

function registerClearLogsCommand(
  context: vscode.ExtensionContext,
  proxyManager: ProxyCommandManager
): void {
  addCommand(context, 'cursorAccounts.proxy.clearLogs', async () => {
    const action = t('commands.proxy.logsDeleteConfirmAction');
    const confirmation = await vscode.window.showWarningMessage(
      t('commands.proxy.logsDeleteConfirm'),
      { modal: true },
      action
    );
    if (confirmation !== action) return;

    try {
      const result = await proxyManager.clearLogFiles();
      vscode.window.showInformationMessage(
        t('commands.proxy.logsDeleted', {
          count: String(result.deletedFiles),
        })
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        t('commands.proxy.logsDeleteFailed', {
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  });
}

function registerShowOutputCommand(
  context: vscode.ExtensionContext,
  proxyManager: ProxyCommandManager,
  profileDetector: IProfileDetector
): void {
  addCommand(context, 'cursorAccounts.proxy.showOutput', async () => {
    const currentProfile = await getEnabledCurrentProfile(profileDetector);
    if (!currentProfile) return;

    const tailFromStart = vscode.workspace
      .getConfiguration('cursorAccounts.proxy')
      .get<boolean>('outputTailFromStart', false);
    await proxyManager.ensureOutputTailer(currentProfile.id, { tailFromStart });
    proxyManager.showOutputChannel();
  });
}

function registerOutputCommands(
  context: vscode.ExtensionContext,
  proxyManager: ProxyCommandManager
): void {
  addCommand(context, 'cursorAccounts.proxy.showTokenDetector', () => {
    proxyManager.showTokenDetectorChannel();
  });
}

function registerSaveCertificateCommand(
  context: vscode.ExtensionContext,
  proxyManager: ProxyCommandManager
): void {
  addCommand(context, 'cursorAccounts.proxy.saveCertificate', async () => {
    const result = await saveCaCertificateAs(proxyManager);
    if (result.cancelled) return;
    if (result.saved && result.path) {
      vscode.window.showInformationMessage(
        t('commands.proxy.saveCertificate.saved', { path: result.path })
      );
      return;
    }
    vscode.window.showErrorMessage(
      t('commands.proxy.saveCertificate.failed', {
        error: result.error ?? t('commands.proxy.saveCertificate.notFound'),
      })
    );
  });
}

function addCommand(
  context: vscode.ExtensionContext,
  command: string,
  handler: ProxyCommandHandler
): void {
  context.subscriptions.push(vscode.commands.registerCommand(command, handler));
}
