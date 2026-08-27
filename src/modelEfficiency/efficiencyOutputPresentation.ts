import type { PromptMetadata, ScoringResult } from './types';

/** Score below which the selected model is considered inefficient. */
export const INEFFICIENT_SCORE_THRESHOLD = 0.7;

/** Localized text required by the pure efficiency-output presentation policy. */
export interface EfficiencyOutputLabels {
  errorTitle: string;
  promptLabel: string;
  modelLabel: string;
  errorLabel: string;
  analysisTitle: string;
  selectedModel: (model: string) => string;
  taskType: (type: string) => string;
  efficiencyScore: (score: string) => string;
  severity: (severity: string) => string;
  confidence: (confidence: string) => string;
  notice: (opinion: string) => string;
  recommendation: (model: string) => string;
  modelAdequate: string;
  inefficientNotification: (opinion: string) => string;
  viewDetails: string;
}

/** Settings that affect output visibility, without exposing VS Code types. */
export interface EfficiencyOutputSettings {
  showNotificationOnHigh: boolean;
  autoShowOutputChannel: boolean;
}

/** Notification request returned by the pure presentation policy. */
export interface EfficiencyOutputNotification {
  message: string;
  actionLabel: string;
}

/** Rendered output and side effects requested by the presentation policy. */
export interface EfficiencyOutputPresentation {
  lines: readonly string[];
  shouldShowOutputChannel: boolean;
  notification?: EfficiencyOutputNotification;
}

export type EfficiencyTimeFormatter = (timestamp: number) => string;

const OUTPUT_DIVIDER = '═'.repeat(60);
const OUTPUT_SEPARATOR = '─'.repeat(60);

/** Builds the output-channel lines for an analysis failure. */
export function buildEfficiencyErrorLines(
  message: string,
  metadata: PromptMetadata | undefined,
  labels: EfficiencyOutputLabels,
  timestamp: number,
  formatTime: EfficiencyTimeFormatter
): readonly string[] {
  const lines = [
    OUTPUT_DIVIDER,
    `[${formatTime(timestamp)}] ${labels.errorTitle}`,
  ];

  if (metadata) {
    const promptExcerpt = metadata.prompt.slice(0, 80);
    lines.push(
      `${labels.promptLabel} "${promptExcerpt}${metadata.prompt.length > 80 ? '...' : ''}"`,
      `${labels.modelLabel} ${metadata.model}`
    );
  }

  lines.push(`${labels.errorLabel} ${message}`, OUTPUT_DIVIDER, '');
  return lines;
}

/** Builds analysis lines and explicit UI requests for the VS Code adapter. */
export function buildEfficiencyAnalysisPresentation(
  result: ScoringResult,
  labels: EfficiencyOutputLabels,
  settings: EfficiencyOutputSettings,
  formatTime: EfficiencyTimeFormatter
): EfficiencyOutputPresentation {
  const isInefficient = result.efficiencyScore < INEFFICIENT_SCORE_THRESHOLD;
  const lines = [
    OUTPUT_DIVIDER,
    `[${formatTime(result.scoredAt)}] ${labels.analysisTitle}`,
    OUTPUT_SEPARATOR,
    `${labels.promptLabel} "${result.promptExcerpt}..."`,
    labels.selectedModel(result.selectedModel),
    labels.taskType(result.taskType),
    labels.efficiencyScore((result.efficiencyScore * 100).toFixed(0)),
    labels.severity(result.severity.toUpperCase()),
    labels.confidence((result.confidence * 100).toFixed(0)),
  ];

  if (isInefficient) {
    lines.push(
      '',
      labels.notice(result.opinion),
      labels.recommendation(result.recommendedModel)
    );
  } else {
    lines.push(labels.modelAdequate);
  }

  lines.push(OUTPUT_DIVIDER, '');

  const notification =
    settings.showNotificationOnHigh && result.severity === 'high' && isInefficient
      ? {
          message: labels.inefficientNotification(result.opinion),
          actionLabel: labels.viewDetails,
        }
      : undefined;

  return {
    lines,
    shouldShowOutputChannel: settings.autoShowOutputChannel,
    notification,
  };
}
