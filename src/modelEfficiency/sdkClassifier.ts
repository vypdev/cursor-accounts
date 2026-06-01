import * as extensionLog from '../logging/extensionLog';
import { getLocale, t } from '../l10n';
import { modelBaseComparisonKey } from './modelBaseName';
import type {
  EfficiencySeverity,
  EfficiencyTaskType,
  PromptMetadata,
  ScoringResult,
  SdkClassificationPayload,
} from './types';

const VALID_TASK_TYPES = new Set<string>([
  'factual_simple',
  'explanation',
  'debugging',
  'refactor',
  'codegen_scoped',
  'architecture',
  'review',
  'unknown',
]);

const VALID_SEVERITIES = new Set<string>(['low', 'medium', 'high']);

export class SdkClassifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SdkClassifierError';
  }
}

export function buildClassificationPrompt(metadata: PromptMetadata): string {
  const attachmentSummary =
    metadata.attachments.length === 0
      ? 'none'
      : metadata.attachments
          .map((a) => `${a.type}:${a.file_path}`)
          .join(', ');

  return [
    t('efficiency.classifier.languageInstruction', { locale: getLocale() }),
    '',
    'You are a model-efficiency advisor for Cursor IDE.',
    'Analyze whether the SELECTED model is appropriate for the USER prompt.',
    'Respond with ONLY a single JSON object (no markdown, no prose) using this schema:',
    '{',
    '  "taskType": "factual_simple|explanation|debugging|refactor|codegen_scoped|architecture|review|unknown",',
    '  "requiredTier": 1,',
    '  "actualTier": 1,',
    '  "efficiencyScore": 0.0,',
    '  "severity": "low|medium|high",',
    '  "confidence": 0.0,',
    `  "opinion": "${t('efficiency.classifier.opinionLang')}",`,
    '  "recommendedModel": "suggested model id if inefficient"',
    '}',
    'Tier rules: 1=light (fast/mini), 2=balanced (sonnet/composer), 3=premium (opus/thinking).',
    'efficiencyScore: 1.0 = perfect match; below 0.7 = inefficient (oversized model).',
    'If the selected model is oversized for a simple factual question, set severity high and score below 0.5.',
    '',
    `Prompt: ${JSON.stringify(metadata.prompt)}`,
    `Selected model: ${JSON.stringify(metadata.model)}`,
    `Attachments (${metadata.attachments.length}): ${attachmentSummary}`,
  ].join('\n');
}

export function parseClassificationJson(raw: string): SdkClassificationPayload {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0] : trimmed;

  try {
    return JSON.parse(candidate) as SdkClassificationPayload;
  } catch {
    throw new SdkClassifierError(t('efficiency.classifier.sdkNonJson'));
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeTaskType(value: unknown): EfficiencyTaskType {
  if (typeof value === 'string' && VALID_TASK_TYPES.has(value)) {
    return value as EfficiencyTaskType;
  }
  return 'unknown';
}

function normalizeSeverity(value: unknown): EfficiencySeverity {
  if (typeof value === 'string' && VALID_SEVERITIES.has(value)) {
    return value as EfficiencySeverity;
  }
  return 'medium';
}

function applyBaseModelEquivalence(
  metadata: PromptMetadata,
  payload: SdkClassificationPayload
): SdkClassificationPayload {
  const recommendedModel =
    typeof payload.recommendedModel === 'string'
      ? payload.recommendedModel.trim()
      : '';
  if (!recommendedModel || recommendedModel === 'auto') {
    return payload;
  }

  const selectedKey = modelBaseComparisonKey(metadata.model);
  const recommendedKey = modelBaseComparisonKey(recommendedModel);
  if (!selectedKey || !recommendedKey || selectedKey !== recommendedKey) {
    return payload;
  }

  return {
    ...payload,
    efficiencyScore: Math.max(Number(payload.efficiencyScore) || 0, 0.7),
    severity: 'low',
    recommendedModel: metadata.model,
  };
}

export function mapPayloadToScoringResult(
  metadata: PromptMetadata,
  payload: SdkClassificationPayload
): ScoringResult {
  const adjusted = applyBaseModelEquivalence(metadata, payload);
  return {
    promptExcerpt: metadata.prompt.slice(0, 120),
    selectedModel: metadata.model,
    taskType: normalizeTaskType(adjusted.taskType),
    requiredTier: Number(adjusted.requiredTier) || 2,
    actualTier: Number(adjusted.actualTier) || 2,
    efficiencyScore: clamp01(Number(adjusted.efficiencyScore)),
    severity: normalizeSeverity(adjusted.severity),
    opinion:
      typeof adjusted.opinion === 'string' && adjusted.opinion.trim()
        ? adjusted.opinion.trim()
        : t('efficiency.classifier.noOpinion'),
    recommendedModel:
      typeof adjusted.recommendedModel === 'string'
        ? adjusted.recommendedModel
        : 'auto',
    confidence: clamp01(Number(adjusted.confidence)),
    scoredAt: Date.now(),
  };
}

export interface SdkClassifier {
  classify(metadata: PromptMetadata, apiKey: string): Promise<ScoringResult>;
}

export class CursorSdkClassifier implements SdkClassifier {
  async classify(
    metadata: PromptMetadata,
    apiKey: string
  ): Promise<ScoringResult> {
    const prompt = buildClassificationPrompt(metadata);
    const cwd =
      metadata.workspaceRoots[0] ??
      process.cwd();

    try {
      const { Agent } = await import('@cursor/sdk');
      const result = await Agent.prompt(prompt, {
        apiKey,
        model: { id: 'auto' },
        local: { cwd },
      });

      if (result.status !== 'finished') {
        throw new SdkClassifierError(
          `Classification run ended with status: ${result.status}`
        );
      }

      const text = result.result?.trim();
      if (!text) {
        throw new SdkClassifierError(t('efficiency.classifier.sdkEmpty'));
      }

      const payload = parseClassificationJson(text);
      return mapPayloadToScoringResult(metadata, payload);
    } catch (error) {
      if (error instanceof SdkClassifierError) {
        throw error;
      }
      extensionLog.error(
        `[SdkClassifier] ${error instanceof Error ? error.message : String(error)}`
      );
      throw new SdkClassifierError(
        error instanceof Error ? error.message : t('efficiency.classifier.sdkFailed')
      );
    }
  }
}
