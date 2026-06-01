import * as vscode from 'vscode';
import type { PromptMetadata, ScoringResult } from './types';
import { t } from '../l10n';

export interface ModelEfficiencyConfig {
  showNotificationOnHigh: boolean;
  autoShowOutputChannel: boolean;
}

export function getModelEfficiencyConfig(): ModelEfficiencyConfig {
  const cfg = vscode.workspace.getConfiguration('cursorAccounts.modelEfficiency');
  return {
    showNotificationOnHigh: cfg.get<boolean>(
      'showNotificationOnHigh',
      true
    ),
    autoShowOutputChannel: cfg.get<boolean>('autoShowOutputChannel', false),
  };
}

export class OutputPresenter {
  private readonly channel: vscode.OutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel(
      t('efficiency.output.channelName')
    );
  }

  dispose(): void {
    this.channel.dispose();
  }

  show(): void {
    this.channel.show(true);
  }

  appendStatus(message: string): void {
    this.channel.appendLine(
      `[${new Date().toLocaleTimeString()}] ${message}`
    );
  }

  presentError(message: string, metadata?: PromptMetadata): void {
    this.channel.appendLine('═'.repeat(60));
    this.channel.appendLine(
      `[${new Date().toLocaleTimeString()}] ${t('efficiency.output.errorTitle')}`
    );
    if (metadata) {
      this.channel.appendLine(
        `${t('efficiency.output.promptLabel')} "${metadata.prompt.slice(0, 80)}${metadata.prompt.length > 80 ? '...' : ''}"`
      );
      this.channel.appendLine(
        `${t('efficiency.output.modelLabel')} ${metadata.model}`
      );
    }
    this.channel.appendLine(`${t('efficiency.output.errorLabel')} ${message}`);
    this.channel.appendLine('═'.repeat(60));
    this.channel.appendLine('');
  }

  present(result: ScoringResult, _metadata: PromptMetadata): void {
    const settings = getModelEfficiencyConfig();
    const viewDetailsLabel = t('efficiency.output.viewDetails');

    this.channel.appendLine('═'.repeat(60));
    this.channel.appendLine(
      `[${new Date(result.scoredAt).toLocaleTimeString()}] ${t('efficiency.output.analysisTitle')}`
    );
    this.channel.appendLine('─'.repeat(60));
    this.channel.appendLine(`${t('efficiency.output.promptLabel')} "${result.promptExcerpt}..."`);
    this.channel.appendLine(
      t('efficiency.output.selectedModel', { model: result.selectedModel })
    );
    this.channel.appendLine(
      t('efficiency.output.taskType', { type: result.taskType })
    );
    this.channel.appendLine(
      t('efficiency.output.efficiencyScore', {
        score: (result.efficiencyScore * 100).toFixed(0),
      })
    );
    this.channel.appendLine(
      t('efficiency.output.severity', {
        severity: result.severity.toUpperCase(),
      })
    );
    this.channel.appendLine(
      t('efficiency.output.confidence', {
        confidence: (result.confidence * 100).toFixed(0),
      })
    );

    if (result.efficiencyScore < 0.7) {
      this.channel.appendLine('');
      this.channel.appendLine(
        t('efficiency.output.notice', { opinion: result.opinion })
      );
      this.channel.appendLine(
        t('efficiency.output.recommendation', {
          model: result.recommendedModel,
        })
      );
    } else {
      this.channel.appendLine(t('efficiency.output.modelAdequate'));
    }

    this.channel.appendLine('═'.repeat(60));
    this.channel.appendLine('');

    if (settings.autoShowOutputChannel) {
      this.channel.show(true);
    }

    if (
      settings.showNotificationOnHigh &&
      result.severity === 'high' &&
      result.efficiencyScore < 0.7
    ) {
      void vscode.window
        .showInformationMessage(
          t('efficiency.output.inefficientNotification', {
            opinion: result.opinion,
          }),
          viewDetailsLabel
        )
        .then((action) => {
          if (action === viewDetailsLabel) {
            this.channel.show(true);
          }
        });
    }
  }
}
