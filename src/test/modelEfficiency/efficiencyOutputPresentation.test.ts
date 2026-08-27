import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildEfficiencyAnalysisPresentation,
  buildEfficiencyErrorLines,
  INEFFICIENT_SCORE_THRESHOLD,
  type EfficiencyOutputLabels,
} from '../../modelEfficiency/efficiencyOutputPresentation';
import type { PromptMetadata, ScoringResult } from '../../modelEfficiency/types';

const LABELS: EfficiencyOutputLabels = {
  errorTitle: 'Analysis error',
  promptLabel: 'Prompt:',
  modelLabel: 'Model:',
  errorLabel: 'Error:',
  analysisTitle: 'Model efficiency analysis',
  selectedModel: (model) => `Selected model: ${model}`,
  taskType: (type) => `Task type: ${type}`,
  efficiencyScore: (score) => `Efficiency score: ${score}%`,
  severity: (severity) => `Severity: ${severity}`,
  confidence: (confidence) => `Confidence: ${confidence}%`,
  notice: (opinion) => `Notice: ${opinion}`,
  recommendation: (model) => `Recommendation: ${model}`,
  modelAdequate: 'The selected model is adequate.',
  inefficientNotification: (opinion) => `Inefficient model: ${opinion}`,
  viewDetails: 'View details',
};

const RESULT: ScoringResult = {
  promptExcerpt: 'Explain this function',
  selectedModel: 'model-a',
  taskType: 'explanation',
  requiredTier: 1,
  actualTier: 2,
  efficiencyScore: 0.8,
  severity: 'low',
  opinion: 'The selected model is suitable.',
  recommendedModel: 'model-a',
  confidence: 0.9,
  scoredAt: 200,
};

const METADATA: PromptMetadata = {
  timestamp: 100,
  prompt: 'Explain this function',
  model: 'model-a',
  attachments: [],
  conversationId: 'conversation-a',
  workspaceRoots: ['/workspace'],
};

const formatTime = (timestamp: number) => `time-${timestamp}`;

describe('efficiency output presentation policy', () => {
  it('renders an adequate analysis without a recommendation or notification', () => {
    const presentation = buildEfficiencyAnalysisPresentation(
      RESULT,
      LABELS,
      { autoShowOutputChannel: false, showNotificationOnHigh: true },
      formatTime
    );

    assert.equal(presentation.shouldShowOutputChannel, false);
    assert.equal(presentation.notification, undefined);
    assert.ok(presentation.lines.includes('The selected model is adequate.'));
    assert.equal(
      presentation.lines.includes('Recommendation: model-a'),
      false
    );
  });

  it('renders an inefficient high-severity analysis and requests notification', () => {
    const presentation = buildEfficiencyAnalysisPresentation(
      {
        ...RESULT,
        efficiencyScore: INEFFICIENT_SCORE_THRESHOLD - 0.01,
        severity: 'high',
        opinion: 'Use a smaller model for this task.',
        recommendedModel: 'model-small',
      },
      LABELS,
      { autoShowOutputChannel: true, showNotificationOnHigh: true },
      formatTime
    );

    assert.equal(presentation.shouldShowOutputChannel, true);
    assert.deepEqual(presentation.notification, {
      message: 'Inefficient model: Use a smaller model for this task.',
      actionLabel: 'View details',
    });
    assert.ok(
      presentation.lines.includes(
        'Recommendation: model-small'
      )
    );
  });

  it('does not request notification when high-severity notifications are disabled', () => {
    const presentation = buildEfficiencyAnalysisPresentation(
      { ...RESULT, efficiencyScore: 0.1, severity: 'high' },
      LABELS,
      { autoShowOutputChannel: false, showNotificationOnHigh: false },
      formatTime
    );

    assert.equal(presentation.notification, undefined);
  });

  it('renders error metadata with the bounded prompt excerpt', () => {
    const metadata = {
      ...METADATA,
      prompt: 'x'.repeat(81),
    };

    assert.deepEqual(
      buildEfficiencyErrorLines(
        'Classifier unavailable',
        metadata,
        LABELS,
        300,
        formatTime
      ),
      [
        '═'.repeat(60),
        '[time-300] Analysis error',
        `${LABELS.promptLabel} "${'x'.repeat(80)}..."`,
        'Model: model-a',
        'Error: Classifier unavailable',
        '═'.repeat(60),
        '',
      ]
    );
  });

  it('renders errors without optional metadata', () => {
    const lines = buildEfficiencyErrorLines(
      'Classifier unavailable',
      undefined,
      LABELS,
      300,
      formatTime
    );

    assert.deepEqual(lines, [
      '═'.repeat(60),
      '[time-300] Analysis error',
      'Error: Classifier unavailable',
      '═'.repeat(60),
      '',
    ]);
  });
});
