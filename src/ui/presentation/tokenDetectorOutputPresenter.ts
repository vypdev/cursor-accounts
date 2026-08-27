import * as vscode from 'vscode';
import { t } from '../../l10n';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';
import type { ITokenDetectorOutputPresenter } from '../../domain/ports/IProxyOutputPresenter';
import {
  formatTokenDetectorLine,
  TOKEN_DETECTOR_TAG,
} from './tokenDetectorLineFormatter';

export { formatTokenDetectorLine, TOKEN_DETECTOR_TAG } from './tokenDetectorLineFormatter';

export interface TokenDetectorOutputConfig {
  logTokenDetectorToOutput: boolean;
  autoShowTokenDetectorChannel: boolean;
}

export function getTokenDetectorOutputConfig(): TokenDetectorOutputConfig {
  const cfg = vscode.workspace.getConfiguration('cursorAccounts.proxy');
  return {
    logTokenDetectorToOutput: cfg.get<boolean>('logTokenDetectorToOutput', true),
    autoShowTokenDetectorChannel: cfg.get<boolean>(
      'autoShowTokenDetectorChannel',
      false
    ),
  };
}

/**
 * Output channel for live agent/token detection from proxy API (no JSONL tail required).
 */
export class TokenDetectorOutputPresenter implements ITokenDetectorOutputPresenter {
  private readonly channel: vscode.OutputChannel;
  private autoShowPending = false;

  constructor() {
    this.channel = vscode.window.createOutputChannel(
      t('tokenDetector.output.channelName')
    );
  }

  dispose(): void {
    this.channel.dispose();
  }

  show(): void {
    this.channel.show(true);
  }

  appendInitialized(profileId: string): void {
    this.appendLine(
      t('tokenDetector.output.trackingInitialized', {
        profileId:
          profileId.length <= 8 ? profileId : profileId.slice(0, 8),
      })
    );
  }

  appendTraffic(summary: ProxyTrafficSummary, profileId?: string): void {
    const settings = getTokenDetectorOutputConfig();
    if (!settings.logTokenDetectorToOutput) {
      return;
    }

    const line = formatTokenDetectorLine(summary, profileId);
    if (!line) {
      return;
    }

    this.channel.appendLine(line);

    if (settings.autoShowTokenDetectorChannel && !this.autoShowPending) {
      this.autoShowPending = true;
      this.channel.show(true);
    }
  }

  appendNote(message: string): void {
    const settings = getTokenDetectorOutputConfig();
    if (!settings.logTokenDetectorToOutput) {
      return;
    }
    this.appendLine(message);
  }

  private appendLine(message: string): void {
    this.channel.appendLine(
      `[${new Date().toLocaleTimeString(undefined, { hour12: false })}] ${TOKEN_DETECTOR_TAG} ${message}`
    );
  }
}
