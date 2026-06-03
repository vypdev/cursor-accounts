import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { IProxyManager } from '../domain/ports/IProxyManager';
import { t } from '../l10n';

export interface SaveCaCertificateResult {
  saved: boolean;
  cancelled: boolean;
  path?: string;
  error?: string;
}

/**
 * Prompts the user to pick a destination and copies the proxy CA certificate there.
 */
export async function saveCaCertificateAs(
  proxyManager: IProxyManager
): Promise<SaveCaCertificateResult> {
  const sourcePath = await proxyManager.getCertificatePath();
  if (!sourcePath) {
    return {
      saved: false,
      cancelled: false,
      error: t('commands.proxy.saveCertificate.notFound'),
    };
  }

  const defaultUri = vscode.Uri.file(
    path.join(os.homedir(), 'Downloads', 'cursor-accounts-ca-cert.pem')
  );

  const targetUri = await vscode.window.showSaveDialog({
    title: t('commands.proxy.saveCertificate.dialogTitle'),
    defaultUri,
    filters: {
      Certificates: ['pem', 'crt'],
    },
    saveLabel: t('webview.proxy.downloadCa'),
  });

  if (!targetUri) {
    return { saved: false, cancelled: true };
  }

  try {
    await fs.copyFile(sourcePath, targetUri.fsPath);
    return { saved: true, cancelled: false, path: targetUri.fsPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { saved: false, cancelled: false, error: message };
  }
}
