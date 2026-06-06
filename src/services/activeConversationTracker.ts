import * as vscode from 'vscode';
import type { ActiveConversationState } from '../application/types/activeConversation';
import type { IActiveConversationRepository } from '../domain/ports/IActiveConversationRepository';
import type { IWorkspaceStateDbPathResolver } from '../domain/ports/IWorkspaceStateDbPathResolver';
import * as extensionLog from '../logging/extensionLog';

export type ActiveConversationChangeListener = (
  state: ActiveConversationState | null
) => void;

const DEFAULT_POLL_INTERVAL_MS = 400;
const MIN_POLL_INTERVAL_MS = 100;
const MAX_POLL_INTERVAL_MS = 5000;

function getPollIntervalMs(): number {
  const cfg = vscode.workspace.getConfiguration('cursorAccounts.debug');
  const ms = cfg.get<number>(
    'activeConversationPollIntervalMs',
    DEFAULT_POLL_INTERVAL_MS
  );
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, ms));
}

/**
 * Polls workspace `composer.composerData` and notifies listeners when focus changes.
 */
export class ActiveConversationTracker {
  private interval?: ReturnType<typeof setInterval>;
  private ticking = false;
  private lastSnapshot = '';
  private loggedMissingDbPath = false;
  private readonly listeners = new Set<ActiveConversationChangeListener>();

  constructor(
    private readonly repository: IActiveConversationRepository,
    private readonly pathResolver: IWorkspaceStateDbPathResolver
  ) {}

  onChange(listener: ActiveConversationChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.interval) {
      return;
    }

    const ms = getPollIntervalMs();
    this.interval = setInterval(() => {
      void this.tick();
    }, ms);

    void this.tick();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  async tickNow(): Promise<ActiveConversationState | null> {
    return this.tick();
  }

  private async tick(): Promise<ActiveConversationState | null> {
    if (this.ticking) {
      return null;
    }

    this.ticking = true;
    try {
      const dbPath = this.pathResolver.resolve();
      if (!dbPath) {
        if (!this.loggedMissingDbPath) {
          this.loggedMissingDbPath = true;
          extensionLog.debug(
            '[ActiveConversation] Workspace state.vscdb path not resolved (storageUri or open folder fallback)'
          );
        }
        this.emitIfChanged(null);
        return null;
      }

      this.loggedMissingDbPath = false;
      const state = await this.repository.read(dbPath);
      if (!state?.lastFocusedComposerId) {
        extensionLog.debug(
          `[ActiveConversation] No lastFocusedComposerIds in ${dbPath}`
        );
      }
      this.emitIfChanged(state);
      return state;
    } finally {
      this.ticking = false;
    }
  }

  private emitIfChanged(state: ActiveConversationState | null): void {
    const snapshot = JSON.stringify(state);
    if (snapshot === this.lastSnapshot) {
      return;
    }
    this.lastSnapshot = snapshot;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
