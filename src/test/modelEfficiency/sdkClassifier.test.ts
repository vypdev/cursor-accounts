import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildClassificationPrompt,
  mapPayloadToScoringResult,
  parseClassificationJson,
} from '../../modelEfficiency/sdkClassifier';
import { PromptMetadata } from '../../modelEfficiency/types';

const sampleMetadata: PromptMetadata = {
  timestamp: Date.now(),
  prompt: '¿Cuál es la capital de España?',
  model: 'claude-4.6-opus-high-thinking',
  attachments: [],
  conversationId: 'conv-1',
  workspaceRoots: ['/tmp/workspace'],
};

describe('sdkClassifier helpers', () => {
  it('buildClassificationPrompt includes prompt and model', () => {
    const prompt = buildClassificationPrompt(sampleMetadata);
    assert.match(prompt, /capital de España/);
    assert.match(prompt, /opus/);
  });

  it('parseClassificationJson extracts JSON from markdown wrapper', () => {
    const raw = '```json\n{"taskType":"factual_simple","efficiencyScore":0.2}\n```';
    const parsed = parseClassificationJson(raw);
    assert.equal(parsed.taskType, 'factual_simple');
    assert.equal(parsed.efficiencyScore, 0.2);
  });

  it('mapPayloadToScoringResult normalizes Spain + Opus example', () => {
    const result = mapPayloadToScoringResult(sampleMetadata, {
      taskType: 'factual_simple',
      requiredTier: 1,
      actualTier: 3,
      efficiencyScore: 0.25,
      severity: 'high',
      confidence: 0.92,
      opinion: 'Consulta factual breve; Opus es innecesario.',
      recommendedModel: 'composer-2.5-fast',
    });

    assert.equal(result.taskType, 'factual_simple');
    assert.equal(result.efficiencyScore, 0.25);
    assert.equal(result.severity, 'high');
    assert.equal(result.recommendedModel, 'composer-2.5-fast');
    assert.match(result.opinion, /Opus/);
  });
});
