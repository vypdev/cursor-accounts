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
  proxyManager: IProxyLifecycle &
    IProxyStatus &
    IProxyCertificate &
    IProxyOutput,
  profileDetector: IProfileDetector,
  onStatusChanged?: () => void
): void {
  proxyManager.onStatusChange(() => {
    onStatusChanged?.();
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorAccounts.proxy.start', async () => {
      const currentProfile = await getEnabledCurrentProfile(profileDetector);
      if (!currentProfile) {
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
      const currentProfile = await getEnabledCurrentProfile(profileDetector);
      if (!currentProfile) {
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

    vscode.commands.registerCommand(
      'cursorAccounts.proxy.clearLogs',
      async () => {
        const confirmation = await vscode.window.showWarningMessage(
          t('commands.proxy.logsDeleteConfirm'),
          { modal: true },
          t('commands.proxy.logsDeleteConfirmAction')
        );
        if (confirmation !== t('commands.proxy.logsDeleteConfirmAction')) {
          return;
        }
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
      }
    ),

    vscode.commands.registerCommand('cursorAccounts.proxy.showOutput', async () => {
      const currentProfile = await getEnabledCurrentProfile(profileDetector);
      if (!currentProfile) {
        return;
      }

      const tailFromStart = vscode.workspace
        .getConfiguration('cursorAccounts.proxy')
        .get<boolean>('outputTailFromStart', false);
      await proxyManager.ensureOutputTailer(currentProfile.id, { tailFromStart });
      proxyManager.showOutputChannel();
    }),

    vscode.commands.registerCommand(
      'cursorAccounts.proxy.showTokenDetector',
      () => {
        proxyManager.showTokenDetectorChannel();
      }
    ),

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
