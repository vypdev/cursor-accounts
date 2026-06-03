import * as vscode from 'vscode';
import * as extensionLog from '../logging/extensionLog';

/**
 * Push http.proxy into the active window via VS Code configuration API so the
 * Settings UI (Application > Proxy) reflects the value without a reload.
 */
export async function syncProxyVscodeConfiguration(
  proxyUrl: string
): Promise<void> {
  const httpConfig = vscode.workspace.getConfiguration('http');
  await httpConfig.update('proxy', proxyUrl, vscode.ConfigurationTarget.Global);
  await httpConfig.update(
    'proxySupport',
    'override',
    vscode.ConfigurationTarget.Global
  );
  await httpConfig.update(
    'proxyStrictSSL',
    false,
    vscode.ConfigurationTarget.Global
  );
  extensionLog.info('[Proxy] Synced http.proxy to VS Code configuration API');
}

/**
 * Clear temporary proxy keys from the active window configuration.
 */
export async function clearProxyVscodeConfiguration(): Promise<void> {
  const httpConfig = vscode.workspace.getConfiguration('http');
  await httpConfig.update('proxy', undefined, vscode.ConfigurationTarget.Global);
  await httpConfig.update(
    'proxySupport',
    undefined,
    vscode.ConfigurationTarget.Global
  );
  await httpConfig.update(
    'proxyStrictSSL',
    undefined,
    vscode.ConfigurationTarget.Global
  );
}
