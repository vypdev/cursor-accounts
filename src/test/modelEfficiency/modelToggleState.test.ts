import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isModelEnabled,
  parseModelToggleState,
} from '../../modelEfficiency/modelConfigResolver';

describe('Model Toggle State', () => {
  it('parses enabled and disabled overrides', () => {
    const raw = JSON.stringify({
      aiSettings: {
        modelOverrideEnabled: ['claude-sonnet-4-5'],
        modelOverrideDisabled: ['gpt-5.5', 'claude-opus-4-8'],
      },
    });

    const toggles = parseModelToggleState(raw);

    assert.ok(toggles.enabledOverrides.has('claude-sonnet-4-5'));
    assert.ok(toggles.disabledOverrides.has('gpt-5.5'));
    assert.ok(toggles.disabledOverrides.has('claude-opus-4-8'));
  });

  it('returns empty sets for invalid or missing data', () => {
    const toggles = parseModelToggleState(null);

    assert.equal(toggles.enabledOverrides.size, 0);
    assert.equal(toggles.disabledOverrides.size, 0);
  });

  it('determines enabled state correctly', () => {
    const toggles = parseModelToggleState(
      JSON.stringify({
        aiSettings: {
          modelOverrideEnabled: ['model-a'],
          modelOverrideDisabled: ['model-b'],
        },
      })
    );

    assert.ok(
      isModelEnabled('model-c', { name: 'model-c', defaultOn: true }, toggles)
    );
    assert.ok(
      isModelEnabled('model-a', { name: 'model-a', defaultOn: false }, toggles)
    );
    assert.ok(
      !isModelEnabled('model-b', { name: 'model-b', defaultOn: true }, toggles)
    );
    assert.ok(
      !isModelEnabled('model-d', { name: 'model-d', defaultOn: false }, toggles)
    );
  });
});
