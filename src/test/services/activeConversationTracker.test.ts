import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ActiveConversationState } from '../../application/types/activeConversation';
import type { IActiveConversationRepository } from '../../domain/ports/IActiveConversationRepository';
import type { IWorkspaceStateDbPathResolver } from '../../domain/ports/IWorkspaceStateDbPathResolver';
import { ActiveConversationTracker } from '../../services/activeConversationTracker';

class StubPathResolver implements IWorkspaceStateDbPathResolver {
  constructor(private readonly dbPath: string | null) {}

  resolve(): string | null {
    return this.dbPath;
  }
}

class StubRepository implements IActiveConversationRepository {
  constructor(private states: Array<ActiveConversationState | null>) {}

  private index = 0;

  async read(_workspaceStateDbPath: string): Promise<ActiveConversationState | null> {
    const state = this.states[this.index] ?? null;
    this.index += 1;
    return state;
  }
}

describe('ActiveConversationTracker', () => {
  it('notifies listeners only when focus changes', async () => {
    const tracker = new ActiveConversationTracker(
      new StubRepository([
        {
          lastFocusedComposerId: 'chat-a',
          selectedComposerIds: ['chat-a'],
          sourceKey: 'composer.composerData',
        },
        {
          lastFocusedComposerId: 'chat-a',
          selectedComposerIds: ['chat-a'],
          sourceKey: 'composer.composerData',
        },
        {
          lastFocusedComposerId: 'chat-b',
          selectedComposerIds: ['chat-b'],
          sourceKey: 'composer.composerData',
        },
      ]),
      new StubPathResolver('/tmp/workspace/state.vscdb')
    );

    const seen: Array<string | null> = [];
    tracker.onChange((state) => {
      seen.push(state?.lastFocusedComposerId ?? null);
    });

    await tracker.tickNow();
    await tracker.tickNow();
    await tracker.tickNow();

    assert.deepEqual(seen, ['chat-a', 'chat-b']);
  });

  it('emits null when workspace state db path is unavailable', async () => {
    const tracker = new ActiveConversationTracker(
      new StubRepository([]),
      new StubPathResolver(null)
    );

    let emitted: ActiveConversationState | null | undefined;
    tracker.onChange((state) => {
      emitted = state;
    });

    await tracker.tickNow();
    assert.equal(emitted, null);
  });
});
