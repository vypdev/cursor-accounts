import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type * as vscode from 'vscode';
import type { Profile } from '../../profiles/types';
import {
  APPLICATION_USER_KEY,
  COMPOSER_HEADERS_KEY,
} from '../../modelEfficiency/stateDbReader';
import {
  ComposerDbPoller,
  type ComposerDbPollerDependencies,
} from '../../modelEfficiency/composerDbPoller';
import type { EfficiencyAnalyzer } from '../../modelEfficiency/efficiencyAnalyzer';
import {
  DB_POLLER_STATE_KEY,
  SEEN_BUBBLES_CAP_PER_COMPOSER,
  type DbPollerState,
} from '../../modelEfficiency/types';
import {
  createEmptyPollerState,
  isBubbleSeen,
  markBubbleSeen,
} from '../../modelEfficiency/composerPollerState';

describe('composerDbPoller state', () => {
  it('SEEN_BUBBLES_CAP_PER_COMPOSER is a reasonable FIFO cap', () => {
    assert.equal(SEEN_BUBBLES_CAP_PER_COMPOSER, 200);
  });

  it('DB_POLLER_STATE_KEY is stable for globalState', () => {
    assert.equal(DB_POLLER_STATE_KEY, 'efficiency.dbPollerState');
  });
});

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-a',
    email: 'a@example.com',
    slug: 'a-example-com',
    displayName: 'Profile A',
    userDataDir: '/cursor/profile-a',
    created: new Date(0).toISOString(),
    efficiencyAnalysisEnabled: true,
    ...overrides,
  };
}

function createPollerHarness(options: {
  profile?: Profile | null;
  itemValues?: Map<string, string>;
  cursorValues?: Map<string, string>;
  readItemTableKey?: ComposerDbPollerDependencies['readItemTableKey'];
} = {}) {
  const itemValues = options.itemValues ?? new Map<string, string>();
  const cursorValues = options.cursorValues ?? new Map<string, string>();
  let state: DbPollerState | undefined;
  const queued: unknown[] = [];
  let readItemCalls = 0;
  let scheduled = 0;
  let cleared = 0;
  const context = {
    globalState: {
      get: () => state,
      update: async (_key: string, value: unknown) => {
        state = value as DbPollerState | undefined;
      },
    },
  } as unknown as vscode.ExtensionContext;
  const dependencies: Partial<ComposerDbPollerDependencies> = {
    getProfileStateDbPath: (userDataDir) => `${userDataDir}/state.vscdb`,
    readItemTableKey:
      options.readItemTableKey ??
      (async (_dbPath, key) => {
        readItemCalls += 1;
        return itemValues.get(key) ?? null;
      }),
    readCursorDiskKV: async (_dbPath, key) => cursorValues.get(key) ?? null,
    branchDetector: {
      getCurrentBranch: async () => 'main',
    },
    now: () => 1_000,
    getPollIntervalMs: () => 5_000,
    scheduler: {
      setInterval: () => {
        scheduled += 1;
        return {} as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {
        cleared += 1;
      },
    },
  };
  const analyzer = {
    enqueue: (metadata: unknown) => queued.push(metadata),
  } as unknown as EfficiencyAnalyzer;
  const profileDetector = {
    detectCurrentProfile: async () => options.profile ?? makeProfile(),
  } as never;
  const poller = new ComposerDbPoller(
    context,
    profileDetector,
    '/extension',
    analyzer,
    dependencies
  );

  return {
    poller,
    itemValues,
    cursorValues,
    queued,
    get state() {
      return state;
    },
    get readItemCalls() {
      return readItemCalls;
    },
    get scheduled() {
      return scheduled;
    },
    get cleared() {
      return cleared;
    },
  };
}

describe('composerDbPoller execution', () => {
  it('seeds existing bubbles and enqueues only new eligible prompts', async () => {
    const itemValues = new Map([
      [
        COMPOSER_HEADERS_KEY,
        JSON.stringify({
          allComposers: [
            {
              composerId: 'composer-123',
              lastUpdatedAt: 100,
              trackedGitRepos: [{ repoPath: '/repo' }],
            },
          ],
        }),
      ],
      [APPLICATION_USER_KEY, JSON.stringify({ availableDefaultModels2: [] })],
    ]);
    const cursorValues = new Map([
      [
        'composerData:composer-123',
        JSON.stringify({
          fullConversationHeadersOnly: [
            { bubbleId: 'old-bubble', type: 1 },
          ],
        }),
      ],
    ]);
    const harness = createPollerHarness({ itemValues, cursorValues });

    await harness.poller.pollOnce();

    assert.equal(harness.state?.enabledAt, new Date(1_000).toISOString());
    assert.deepEqual(harness.state?.seenBubbleIds['composer-123'], [
      'old-bubble',
    ]);
    assert.equal(harness.queued.length, 0);

    itemValues.set(
      COMPOSER_HEADERS_KEY,
      JSON.stringify({
        allComposers: [
          {
            composerId: 'composer-123',
            lastUpdatedAt: 200,
            trackedGitRepos: [{ repoPath: '/repo' }],
          },
        ],
      })
    );
    cursorValues.set(
      'composerData:composer-123',
      JSON.stringify({
        fullConversationHeadersOnly: [
          { bubbleId: 'old-bubble', type: 1 },
          { bubbleId: 'new-bubble', type: 1 },
        ],
      })
    );
    cursorValues.set(
      'bubbleId:composer-123:new-bubble',
      JSON.stringify({
        type: 1,
        text: 'Explain the retry policy',
        createdAt: new Date(2_000).toISOString(),
      })
    );

    await harness.poller.pollOnce();
    await harness.poller.pollOnce();

    assert.equal(harness.queued.length, 1);
    assert.deepEqual(harness.queued[0], {
      timestamp: 2_000,
      prompt: 'Explain the retry policy',
      model: 'unknown',
      modelResolved: true,
      attachments: [],
      conversationId: 'composer-123',
      workspaceRoots: ['/repo'],
      gitBranch: 'main',
      userEmail: 'a@example.com',
    });
    assert.deepEqual(harness.state?.seenBubbleIds['composer-123'], [
      'old-bubble',
      'new-bubble',
    ]);
    assert.equal(harness.state?.lastUpdatedAtByComposer['composer-123'], 200);
  });

  it('does not read state for a disabled profile and can be started and stopped once', async () => {
    const harness = createPollerHarness({
      profile: makeProfile({ efficiencyAnalysisEnabled: false }),
    });

    await harness.poller.pollOnce();
    harness.poller.start();
    harness.poller.start();
    harness.poller.stop();

    assert.equal(harness.readItemCalls, 0);
    assert.equal(harness.scheduled, 1);
    assert.equal(harness.cleared, 1);
  });

  it('releases the in-flight guard after a failed read so a later poll can retry', async () => {
    let attempts = 0;
    const harness = createPollerHarness({
      readItemTableKey: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('temporary state database failure');
        }
        return JSON.stringify({ allComposers: [] });
      },
    });

    await harness.poller.pollOnce();
    await harness.poller.pollOnce();

    assert.equal(attempts, 2);
  });
});

describe('composerDbPoller dedup logic', () => {
  it('marking seen bubbles prevents duplicate ids in list', () => {
    const state = createEmptyPollerState();
    markBubbleSeen(state, 'c1', 'b1');
    markBubbleSeen(state, 'c1', 'b1');
    markBubbleSeen(state, 'c1', 'b2');
    assert.deepEqual(state.seenBubbleIds.c1, ['b1', 'b2']);
    assert.equal(isBubbleSeen(state, 'c1', 'b1'), true);
    assert.equal(isBubbleSeen(state, 'c1', 'missing'), false);
  });

  it('keeps only the newest bubble ids when the FIFO cap is exceeded', () => {
    const state = createEmptyPollerState();
    for (let index = 0; index <= SEEN_BUBBLES_CAP_PER_COMPOSER; index += 1) {
      markBubbleSeen(state, 'c1', `b${index}`);
    }

    assert.equal(state.seenBubbleIds.c1?.length, SEEN_BUBBLES_CAP_PER_COMPOSER);
    assert.equal(state.seenBubbleIds.c1?.[0], 'b1');
    assert.equal(state.seenBubbleIds.c1?.at(-1), `b${SEEN_BUBBLES_CAP_PER_COMPOSER}`);
  });
});
