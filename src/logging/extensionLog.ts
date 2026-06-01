import type * as vscode from 'vscode';

export const OUTPUT_CHANNEL_NAME = 'Cursor Accounts';

let channel: vscode.LogOutputChannel | undefined;

export function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  return String(err);
}

function loadVscodeApi(): typeof import('vscode') {
  return require('vscode') as typeof import('vscode');
}

export function init(context: vscode.ExtensionContext): void {
  if (channel) {
    return;
  }

  const vscodeApi = loadVscodeApi();
  channel = vscodeApi.window.createOutputChannel(OUTPUT_CHANNEL_NAME, {
    log: true,
  });
  context.subscriptions.push(channel);
}

function getChannel(): vscode.LogOutputChannel | undefined {
  return channel;
}

export function debug(message: string): void {
  getChannel()?.debug(message);
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

export function trace(message: string): void {
  getChannel()?.trace(message);
}

export function show(): void {
  getChannel()?.show(true);
}

export function appendLine(value: string): void {
  getChannel()?.appendLine(value);
}

export function clear(): void {
  getChannel()?.clear();
}
