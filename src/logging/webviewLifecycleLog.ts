import * as vscode from 'vscode';
import * as extensionLog from './extensionLog';

const LOG_PREFIX = '[WebviewLifecycle]';

let activateTimestamp = 0;

function formatDetails(details?: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) {
    return '';
  }

  const parts = Object.entries(details).map(([key, value]) => {
    if (value === undefined) {
      return `${key}=undefined`;
    }
    if (typeof value === 'object') {
      try {
        return `${key}=${JSON.stringify(value)}`;
      } catch {
        return `${key}=[object]`;
      }
    }
    return `${key}=${String(value)}`;
  });

  return ` ${parts.join(' ')}`;
}

function isVerboseEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('cursorAccounts.debug')
    .get<boolean>('webviewLifecycle', true);
}

export function markActivate(): number {
  activateTimestamp = Date.now();
  return activateTimestamp;
}

export function sinceActivateMs(): number {
  if (activateTimestamp === 0) {
    return 0;
  }
  return Date.now() - activateTimestamp;
}

export function getActivateTimestamp(): number {
  return activateTimestamp;
}

export function lifecycle(
  phase: string,
  details?: Record<string, unknown>
): void {
  extensionLog.info(`${LOG_PREFIX} phase=${phase}${formatDetails(details)}`);
}

export function lifecycleDebug(
  phase: string,
  details?: Record<string, unknown>
): void {
  if (!isVerboseEnabled()) {
    return;
  }

  extensionLog.debug(`${LOG_PREFIX} phase=${phase}${formatDetails(details)}`);
}

export function fromWebview(
  level: 'info' | 'debug',
  message: string,
  phase?: string
): void {
  const phaseSuffix = phase ? ` phase=${phase}` : '';
  const line = `${LOG_PREFIX} source=webview${phaseSuffix} ${message}`;

  if (level === 'info') {
    extensionLog.info(line);
    return;
  }

  if (isVerboseEnabled()) {
    extensionLog.debug(line);
  }
}

/** Reset timing state (for tests). */
export function resetLifecycleTimingForTests(): void {
  activateTimestamp = 0;
}
