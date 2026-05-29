import * as vscode from 'vscode';
import { PromptMetadata, ScoringResult } from './types';

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
    this.channel = vscode.window.createOutputChannel('Cursor Model Efficiency');
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
      `[${new Date().toLocaleTimeString()}] Error de análisis de eficiencia`
    );
    if (metadata) {
      this.channel.appendLine(
        `Prompt: "${metadata.prompt.slice(0, 80)}${metadata.prompt.length > 80 ? '...' : ''}"`
      );
      this.channel.appendLine(`Modelo: ${metadata.model}`);
    }
    this.channel.appendLine(`Error: ${message}`);
    this.channel.appendLine('═'.repeat(60));
    this.channel.appendLine('');
  }

  present(result: ScoringResult, _metadata: PromptMetadata): void {
    const settings = getModelEfficiencyConfig();

    this.channel.appendLine('═'.repeat(60));
    this.channel.appendLine(
      `[${new Date(result.scoredAt).toLocaleTimeString()}] Análisis de eficiencia`
    );
    this.channel.appendLine('─'.repeat(60));
    this.channel.appendLine(`Prompt: "${result.promptExcerpt}..."`);
    this.channel.appendLine(`Modelo seleccionado: ${result.selectedModel}`);
    this.channel.appendLine(`Tipo de tarea: ${result.taskType}`);
    this.channel.appendLine(
      `Score de eficiencia: ${(result.efficiencyScore * 100).toFixed(0)}%`
    );
    this.channel.appendLine(`Severidad: ${result.severity.toUpperCase()}`);
    this.channel.appendLine(
      `Confianza: ${(result.confidence * 100).toFixed(0)}%`
    );

    if (result.efficiencyScore < 0.7) {
      this.channel.appendLine('');
      this.channel.appendLine(`Aviso: ${result.opinion}`);
      this.channel.appendLine(`Recomendación: ${result.recommendedModel}`);
    } else {
      this.channel.appendLine('Selección de modelo adecuada.');
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
          `Modelo ineficiente: ${result.opinion}`,
          'Ver detalles'
        )
        .then((action) => {
          if (action === 'Ver detalles') {
            this.channel.show(true);
          }
        });
    }
  }
}
