import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EfficiencyAnalysisWorkflow } from '../../modelEfficiency/efficiencyAnalysisWorkflow';
import type { Profile } from '../../profiles/types';
import type { PromptMetadata, ScoringResult } from '../../modelEfficiency/types';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-a',
    email: 'a@example.com',
    slug: 'a-example-com',
    displayName: 'Profile A',
    userDataDir: '/tmp/cursor-a',
    created: new Date().toISOString(),
    efficiencyAnalysisEnabled: true,
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<PromptMetadata> = {}): PromptMetadata {
  return {
    timestamp: 100,
    prompt: 'Explain this function',
    model: 'model-a',
    attachments: [],
    conversationId: 'conversation-a',
    workspaceRoots: ['/workspace'],
    gitBranch: 'main',
    userEmail: 'a@example.com',
    ...overrides,
  };
}

function makeResult(): ScoringResult {
  return {
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
}

describe('EfficiencyAnalysisWorkflow', () => {
  it('skips analysis when the current window has no enabled profile', async () => {
    let classifications = 0;
    const workflow = createWorkflow({
      profileDetector: { detectCurrentProfile: async () => undefined },
      sdkClassifier: {
        classify: async () => {
          classifications += 1;
          return makeResult();
        },
      },
    });

    await workflow.run(makeMetadata());

    assert.equal(classifications, 0);
  });

  it('reports a missing API key without invoking the classifier', async () => {
    let classifications = 0;
    const errors: string[] = [];
    const workflow = createWorkflow({
      apiKeyManager: { getApiKey: async () => undefined },
      outputPresenter: {
        appendStatus: () => {},
        present: () => {},
        presentError: (message: string) => errors.push(message),
      },
      sdkClassifier: {
        classify: async () => {
          classifications += 1;
          return makeResult();
        },
      },
    });

    await workflow.run(makeMetadata());

    assert.equal(classifications, 0);
    assert.equal(errors.length, 1);
  });

  it('classifies, records, presents, and updates a successful analysis', async () => {
    const recorded: Array<{ profile: Profile; event: Record<string, unknown> }> = [];
    const presented: ScoringResult[] = [];
    let updated: { id: string; updates: Partial<Profile> } | undefined;
    const profile = makeProfile();
    const workflow = createWorkflow({
      profile,
      outputPresenter: {
        appendStatus: () => {},
        present: (result: ScoringResult) => presented.push(result),
        presentError: () => {},
      },
      statsStorage: {
        recordEvent: async (target: Profile, event: Record<string, unknown>) => {
          recorded.push({ profile: target, event });
        },
      },
      profileManager: {
        updateProfile: async (id: string, updates: Partial<Profile>) => {
          updated = { id, updates };
          return profile;
        },
      },
    });

    await workflow.run(makeMetadata());

    assert.deepEqual(presented, [makeResult()]);
    assert.equal(recorded[0]?.profile, profile);
    assert.equal(recorded[0]?.event.profileId, profile.id);
    assert.equal(recorded[0]?.event.modelUsed, 'model-a');
    assert.equal(recorded[0]?.event.conversationId, 'conversation-a');
    assert.equal(updated?.id, profile.id);
    assert.equal(typeof updated?.updates.metadata?.efficiencyLastAnalysisAt, 'string');
  });

  it('does not analyze an enabled profile that conflicts with the current window', async () => {
    const current = makeProfile({ email: 'current@example.com' });
    const requested = makeProfile({
      id: 'profile-b',
      email: 'requested@example.com',
    });
    let classifications = 0;
    const workflow = createWorkflow({
      profile: current,
      profileManager: {
        findProfileByEmail: async () => requested,
      },
      sdkClassifier: {
        classify: async () => {
          classifications += 1;
          return makeResult();
        },
      },
    });

    await workflow.run(makeMetadata({ userEmail: requested.email }));

    assert.equal(classifications, 0);
  });
});

function createWorkflow(overrides: {
  profile?: Profile;
  profileDetector?: Record<string, unknown>;
  profileManager?: Record<string, unknown>;
  apiKeyManager?: Record<string, unknown>;
  sdkClassifier?: Record<string, unknown>;
  outputPresenter?: Record<string, unknown>;
  statsStorage?: Record<string, unknown>;
} = {}): EfficiencyAnalysisWorkflow {
  const profile = overrides.profile ?? makeProfile();
  const profileManager = {
    findProfileByEmail: async () => profile,
    updateProfile: async () => profile,
    ...overrides.profileManager,
  };
  return new EfficiencyAnalysisWorkflow(
    profileManager as never,
    {
      detectCurrentProfile: async () => profile,
      ...overrides.profileDetector,
    } as never,
    { getApiKey: async () => 'test-api-key', ...overrides.apiKeyManager } as never,
    {
      classify: async () => makeResult(),
      ...overrides.sdkClassifier,
    } as never,
    {
      appendStatus: () => {},
      present: () => {},
      presentError: () => {},
      ...overrides.outputPresenter,
    } as never,
    {
      recordEvent: async () => {},
      ...overrides.statsStorage,
    } as never,
    { getCachedQuota: () => undefined } as never
  );
}
