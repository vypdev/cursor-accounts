import type * as vscode from 'vscode';

export const OUTPUT_CHANNEL_NAME = 'Cursor Accounts';

let channel: vscode.LogOutputChannel | undefined;

export function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  return String(err);
}

export function init(context: vscode.ExtensionContext): void {
  if (channel) {
    return;
  }

  const vscodeApi = require('vscode') as typeof import('vscode');
  channel = vscodeApi.window.createOutputChannel(OUTPUT_CHANNEL_NAME, {
    log: true,
  });
  context.subscriptions.push(channel);
}

function getChannel(): vscode.LogOutputChannel | undefined {
  return channel;
}

export function info(message: string): void {
  getChannel()?.info(message);
}

export function warn(message: string): void {
  getChannel()?.warn(message);
}

export function error(message: string): void {
  getChannel()?.error(message);
}

export function debug(message: string): void {
  getChannel()?.debug(message);
}

export function appendLine(line: string): void {
  getChannel()?.appendLine(line);
}

export function clear(): void {
  getChannel()?.clear();
}

export function show(preserveFocus?: boolean): void {
  getChannel()?.show(preserveFocus);
}
