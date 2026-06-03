import * as vscode from 'vscode';
import type { IProxyManager } from '../domain/ports/IProxyManager';
import type { ProfileDetector } from '../profiles/profileDetector';
import { isProfileProxyEnabled } from '@cursor-accounts/types';
import { t } from '../l10n';
import { saveCaCertificateAs } from '../proxy/saveCaCertificate';

export function registerProxyCommands(
  context: vscode.ExtensionContext,
  proxyManager: IProxyManager,
  profileDetector: ProfileDetector,
  onStatusChanged?: () => void
): void {
  proxyManager.onStatusChange(() => {
    onStatusChanged?.();
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorAccounts.proxy.start', async () => {
      const currentProfile = await profileDetector.detectCurrentProfile();
      if (!currentProfile || !isProfileProxyEnabled(currentProfile)) {
        vscode.window.showWarningMessage(t('commands.proxy.requiresProfile'));
        return;
      }

      const result = await proxyManager.start(currentProfile.id);
      if (result.success) {
        vscode.window.showInformationMessage(
          t('commands.proxy.started', { port: String(result.port ?? '') })
        );
      } else {
        vscode.window.showErrorMessage(
          t('commands.proxy.startFailed', {
            error: result.error ?? t('errors.unknown'),
          })
        );
      }
    }),

    vscode.commands.registerCommand('cursorAccounts.proxy.stop', async () => {
      const currentProfile = await profileDetector.detectCurrentProfile();
      if (!currentProfile || !isProfileProxyEnabled(currentProfile)) {
        vscode.window.showWarningMessage(t('commands.proxy.requiresProfile'));
        return;
      }

      await proxyManager.stop(currentProfile.id);
      vscode.window.showInformationMessage(t('commands.proxy.stopped'));
    }),

    vscode.commands.registerCommand('cursorAccounts.proxy.showLogs', async () => {
      const logDir = proxyManager.getLogDirectory();
      await vscode.commands.executeCommand(
        'revealFileInOS',
        vscode.Uri.file(logDir)
      );
    }),

    vscode.commands.registerCommand('cursorAccounts.proxy.showOutput', async () => {
      const currentProfile = await profileDetector.detectCurrentProfile();
      if (!currentProfile || !isProfileProxyEnabled(currentProfile)) {
        vscode.window.showWarningMessage(t('commands.proxy.requiresProfile'));
        return;
      }

      const tailFromStart = vscode.workspace
        .getConfiguration('cursorAccounts.proxy')
        .get<boolean>('outputTailFromStart', false);
      await proxyManager.ensureOutputTailer(currentProfile.id, { tailFromStart });
      proxyManager.showOutputChannel();
    }),

    vscode.commands.registerCommand(
      'cursorAccounts.proxy.saveCertificate',
      async () => {
        const result = await saveCaCertificateAs(proxyManager);
        if (result.cancelled) {
          return;
        }
        if (result.saved && result.path) {
          vscode.window.showInformationMessage(
            t('commands.proxy.saveCertificate.saved', { path: result.path })
          );
          return;
        }
        vscode.window.showErrorMessage(
          t('commands.proxy.saveCertificate.failed', {
            error:
              result.error ?? t('commands.proxy.saveCertificate.notFound'),
          })
        );
      }
    )
  );
}
