import * as vscode from 'vscode';
import { t } from '../../l10n';
import {
  formatTrafficLine,
  PROXY_TRAFFIC_TAG,
} from '../../proxy/proxyTrafficFormat';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';
import type {
  IProxyOutputPresenter,
  ProxyOutputSettings,
} from '../../domain/ports/IProxyOutputPresenter';

export type ProxyOutputConfig = ProxyOutputSettings;

export function getProxyOutputConfig(): ProxyOutputConfig {
  const cfg = vscode.workspace.getConfiguration('cursorAccounts.proxy');
  return {
    logTrafficToOutput: cfg.get<boolean>('logTrafficToOutput', true),
    autoShowOutputChannel: cfg.get<boolean>('autoShowOutputChannel', false),
    outputCursorHostsOnly: cfg.get<boolean>('outputCursorHostsOnly', false),
  };
}

/**
 * Dedicated Output channel for live MITM proxy traffic ([ProxyTraffic] tag).
 */
export class ProxyOutputPresenter implements IProxyOutputPresenter {
  private readonly channel: vscode.OutputChannel;
  private autoShowPending = false;

  constructor() {
    this.channel = vscode.window.createOutputChannel(
      t('proxy.output.channelName')
    );
  }

  dispose(): void {
    this.channel.dispose();
  }

  show(): void {
    this.channel.show(true);
  }

  appendStarted(port: number): void {
    this.channel.appendLine(
      `[${this.timeLabel()}] ${PROXY_TRAFFIC_TAG} ${t('proxy.output.started', {
        port: String(port),
      })}`
    );
    this.channel.appendLine('');
  }

  appendAttached(port: number): void {
    this.channel.appendLine(
      `[${this.timeLabel()}] ${PROXY_TRAFFIC_TAG} ${t('proxy.output.attached', {
        port: String(port),
      })}`
    );
    this.channel.appendLine('');
  }

  appendTailing(logFilePath: string): void {
    this.channel.appendLine(
      `[${this.timeLabel()}] ${PROXY_TRAFFIC_TAG} ${t('proxy.output.tailing', {
        path: logFilePath,
      })}`
    );
    this.channel.appendLine('');
  }

  appendLogDisabled(): void {
    this.channel.appendLine(
      `[${this.timeLabel()}] ${PROXY_TRAFFIC_TAG} ${t('proxy.output.logDisabled')}`
    );
    this.channel.appendLine('');
  }

  appendStopped(): void {
    this.channel.appendLine(
      `[${this.timeLabel()}] ${PROXY_TRAFFIC_TAG} ${t('proxy.output.stopped')}`
    );
    this.channel.appendLine('');
  }

  /** Periodic bypass/capture summary from the proxy child (tag: [ProxyDiagnostics]). */
  appendDiagnostics(lines: string[]): void {
    if (lines.length === 0) {
      return;
    }
    this.channel.appendLine('');
    for (const line of lines) {
      this.channel.appendLine(`[${this.timeLabel()}] ${line}`);
    }
    this.channel.appendLine('');
  }

  appendTraffic(summary: ProxyTrafficSummary): void {
    const settings = getProxyOutputConfig();
    if (!settings.logTrafficToOutput) {
      return;
    }
    if (settings.outputCursorHostsOnly && !summary.isCursorHost) {
      return;
    }

    this.channel.appendLine(formatTrafficLine(summary));

    if (settings.autoShowOutputChannel && !this.autoShowPending) {
      this.autoShowPending = true;
      this.channel.show(true);
    }
  }

  appendError(summary: ProxyTrafficSummary): void {
    const settings = getProxyOutputConfig();
    if (!settings.logTrafficToOutput) {
      return;
    }
    if (settings.outputCursorHostsOnly && summary.isCursorHost === false) {
      return;
    }

    this.channel.appendLine(formatTrafficLine(summary));

    if (settings.autoShowOutputChannel) {
      this.channel.show(true);
    }
  }

  private timeLabel(): string {
    return new Date().toLocaleTimeString(undefined, { hour12: false });
  }
}
