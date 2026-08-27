import * as vscode from 'vscode';
import type { PromptMetadata, ScoringResult } from './types';
import {
  buildEfficiencyAnalysisPresentation,
  buildEfficiencyErrorLines,
  type EfficiencyOutputLabels,
} from './efficiencyOutputPresentation';
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

function getEfficiencyOutputLabels(): EfficiencyOutputLabels {
  return {
    errorTitle: t('efficiency.output.errorTitle'),
    promptLabel: t('efficiency.output.promptLabel'),
    modelLabel: t('efficiency.output.modelLabel'),
    errorLabel: t('efficiency.output.errorLabel'),
    analysisTitle: t('efficiency.output.analysisTitle'),
    selectedModel: (model) =>
      t('efficiency.output.selectedModel', { model }),
    taskType: (type) => t('efficiency.output.taskType', { type }),
    efficiencyScore: (score) =>
      t('efficiency.output.efficiencyScore', { score }),
    severity: (severity) => t('efficiency.output.severity', { severity }),
    confidence: (confidence) =>
      t('efficiency.output.confidence', { confidence }),
    notice: (opinion) => t('efficiency.output.notice', { opinion }),
    recommendation: (model) =>
      t('efficiency.output.recommendation', { model }),
    modelAdequate: t('efficiency.output.modelAdequate'),
    inefficientNotification: (opinion) =>
      t('efficiency.output.inefficientNotification', { opinion }),
    viewDetails: t('efficiency.output.viewDetails'),
  };
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
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
    this.channel.appendLine(`[${formatTime(Date.now())}] ${message}`);
  }

  presentError(message: string, metadata?: PromptMetadata): void {
    const lines = buildEfficiencyErrorLines(
      message,
      metadata,
      getEfficiencyOutputLabels(),
      Date.now(),
      formatTime
    );
    this.appendLines(lines);
  }

  present(result: ScoringResult, _metadata: PromptMetadata): void {
    const settings = getModelEfficiencyConfig();
    const presentation = buildEfficiencyAnalysisPresentation(
      result,
      getEfficiencyOutputLabels(),
      settings,
      formatTime
    );
    this.appendLines(presentation.lines);

    if (presentation.shouldShowOutputChannel) {
      this.channel.show(true);
    }

    if (presentation.notification) {
      void vscode.window
        .showInformationMessage(
          presentation.notification.message,
          presentation.notification.actionLabel
        )
        .then((action) => {
          if (action === presentation.notification?.actionLabel) {
            this.channel.show(true);
          }
        });
    }
  }

  private appendLines(lines: readonly string[]): void {
    for (const line of lines) {
      this.channel.appendLine(line);
    }
  }
}
