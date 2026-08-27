import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { initL10nForTests } from '../../l10n';
import { EfficiencyAnalyzer } from '../../modelEfficiency/efficiencyAnalyzer';
import type { Profile } from '../../profiles/types';
import type {
  PromptMetadata,
  ScoringResult,
} from '../../modelEfficiency/types';

const PROFILE: Profile = {
  id: 'profile-a',
  email: 'a@example.com',
  slug: 'a-example-com',
  displayName: 'Profile A',
  userDataDir: '/tmp/cursor-a',
  created: '2024-01-01T00:00:00.000Z',
  efficiencyAnalysisEnabled: true,
};

const METADATA: PromptMetadata = {
  timestamp: 100,
  prompt: 'Explain this function',
  model: 'model-a',
  attachments: [],
  conversationId: 'conversation-a',
  workspaceRoots: ['/workspace'],
  gitBranch: 'main',
  userEmail: PROFILE.email,
};

const RESULT: ScoringResult = {
  promptExcerpt: METADATA.prompt,
  selectedModel: METADATA.model,
  taskType: 'explanation',
  requiredTier: 1,
  actualTier: 2,
  efficiencyScore: 0.8,
  severity: 'low',
  opinion: 'The selected model is suitable.',
  recommendedModel: METADATA.model,
  confidence: 0.9,
  scoredAt: 200,
};

describe('EfficiencyAnalyzer', () => {
  it('delegates direct analysis to the application workflow', async () => {
    const fixture = createFixture();

    await fixture.analyzer.analyzePrompt(METADATA);

    assert.equal(fixture.classify.mock.callCount(), 1);
    assert.deepEqual(fixture.classify.mock.calls[0]?.arguments, [
      METADATA,
      'test-api-key',
    ]);
    assert.equal(fixture.presenter.present.mock.callCount(), 1);
    assert.deepEqual(fixture.presenter.present.mock.calls[0]?.arguments, [
      RESULT,
      METADATA,
    ]);
  });

  it('runs queued analysis once for duplicate metadata', async () => {
    const fixture = createFixture();

    fixture.analyzer.enqueue(METADATA);
    fixture.analyzer.enqueue(METADATA);
    await waitForQueue();

    assert.equal(fixture.classify.mock.callCount(), 1);
  });

  it('presents queued analysis failures without rejecting the enqueue call', async () => {
    const presenter = createPresenter();
    const classify = mock.fn(async () => {
      throw new Error('classifier failed');
    });
    const fixture = createFixture({ presenter, classify });

    fixture.analyzer.enqueue(METADATA);
    await waitForQueue();

    assert.deepEqual(presenter.presentError.mock.calls[0]?.arguments, [
      'classifier failed',
      METADATA,
    ]);
  });
});

function createFixture(overrides: {
  presenter?: ReturnType<typeof createPresenter>;
  classify?: ReturnType<typeof mock.fn>;
} = {}) {
  initL10nForTests({
    'efficiency.analyzing': 'Analyzing {model} for {email}',
  });

  const presenter = overrides.presenter ?? createPresenter();
  const classify =
    overrides.classify ?? mock.fn(async () => RESULT);
  const analyzer = new EfficiencyAnalyzer(
    {
      findProfileByEmail: async () => PROFILE,
      updateProfile: async () => PROFILE,
    } as never,
    {
      detectCurrentProfile: async () => PROFILE,
    } as never,
    {
      getApiKey: async () => 'test-api-key',
    } as never,
    { classify } as never,
    presenter as never,
    {
      recordEvent: async () => undefined,
    } as never,
    {
      getCachedQuota: () => undefined,
    } as never
  );

  return { analyzer, classify, presenter };
}

function createPresenter() {
  return {
    dispose: mock.fn(),
    show: mock.fn(),
    appendStatus: mock.fn(),
    presentError: mock.fn(),
    present: mock.fn(),
  };
}

function waitForQueue(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
