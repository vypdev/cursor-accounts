import * as vscode from 'vscode';
import { getProfileStateDbPath } from '../auth/cursorPaths';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { Profile } from '../profiles/types';
import * as extensionLog from '../logging/extensionLog';
import {
  extractWorkspaceRoots,
  getUserBubbleHeaders,
  parseBubbleRow,
  parseComposerData,
  parseComposerHeaders,
} from './composerDbParse';
import { buildPromptMetadata } from './composerPromptMetadata';
import {
  createEmptyPollerState,
  isBubbleSeen,
  markBubbleSeen,
} from './composerPollerState';
import type { EfficiencyAnalyzer } from './efficiencyAnalyzer';
import { GitBranchDetector } from './gitBranchDetector';
import type { ModelCatalogEntry } from './modelConfigResolver';
import {
  parseModelCatalog,
  resolveModelConfig,
} from './modelConfigResolver';
import {
  APPLICATION_USER_KEY,
  bubbleIdKey,
  COMPOSER_HEADERS_KEY,
  composerDataKey,
  readCursorDiskKV,
  readItemTableKey,
} from './stateDbReader';
import type {
  ComposerHeaderEntry,
  DbPollerState,
} from './types';
import {
  DB_POLLER_STATE_KEY,
} from './types';

const DEFAULT_POLL_INTERVAL_SECONDS = 10;
const MIN_POLL_INTERVAL_SECONDS = 5;
const MAX_POLL_INTERVAL_SECONDS = 60;

function getPollIntervalMs(): number {
  const cfg = vscode.workspace.getConfiguration('cursorAccounts.modelEfficiency');
  const seconds = cfg.get<number>(
    'pollIntervalSeconds',
    DEFAULT_POLL_INTERVAL_SECONDS
  );
  const clamped = Math.min(
    MAX_POLL_INTERVAL_SECONDS,
    Math.max(MIN_POLL_INTERVAL_SECONDS, seconds)
  );
  return clamped * 1000;
}

export interface PollerScheduler {
  setInterval(
    callback: () => void,
    delayMs: number
  ): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}

/** External boundaries used by the Composer state poller. */
export interface ComposerDbPollerDependencies {
  readItemTableKey: typeof readItemTableKey;
  readCursorDiskKV: typeof readCursorDiskKV;
  getProfileStateDbPath: typeof getProfileStateDbPath;
  branchDetector: Pick<GitBranchDetector, 'getCurrentBranch'>;
  now: () => number;
  getPollIntervalMs: () => number;
  scheduler: PollerScheduler;
}

const defaultDependencies: ComposerDbPollerDependencies = {
  readItemTableKey,
  readCursorDiskKV,
  getProfileStateDbPath,
  branchDetector: new GitBranchDetector(),
  now: () => Date.now(),
  getPollIntervalMs,
  scheduler: {
    setInterval: (callback, delayMs) => setInterval(callback, delayMs),
    clearInterval: (handle) => clearInterval(handle),
  },
};

export class ComposerDbPoller {
  private interval?: ReturnType<typeof setInterval>;
  private ticking = false;
  private readonly dependencies: ComposerDbPollerDependencies;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileDetector: IProfileDetector,
    private readonly extensionPath: string,
    private readonly analyzer: EfficiencyAnalyzer,
    dependencies: Partial<ComposerDbPollerDependencies> = {}
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  start(): void {
    if (this.interval) {
      return;
    }

    const ms = this.dependencies.getPollIntervalMs();
    this.interval = this.dependencies.scheduler.setInterval(() => {
      void this.pollOnce();
    }, ms);

    extensionLog.info(
      `[ComposerDbPoller] Started (interval ${ms / 1000}s, state.vscdb)`
    );

    void this.pollOnce();
  }

  stop(): void {
    if (this.interval) {
      this.dependencies.scheduler.clearInterval(this.interval);
      this.interval = undefined;
      extensionLog.info('[ComposerDbPoller] Stopped');
    }
  }

  async resetState(): Promise<void> {
    await this.context.globalState.update(DB_POLLER_STATE_KEY, undefined);
    extensionLog.info('[ComposerDbPoller] Cleared poller state');
  }

  private loadState(): DbPollerState {
    return (
      this.context.globalState.get<DbPollerState>(DB_POLLER_STATE_KEY) ??
      createEmptyPollerState()
    );
  }

  private async saveState(state: DbPollerState): Promise<void> {
    await this.context.globalState.update(DB_POLLER_STATE_KEY, state);
  }

  /** Run one poll cycle; scheduled and test/manual callers share this path. */
  async pollOnce(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;

    try {
      const profile = await this.profileDetector.detectCurrentProfile();
      if (!profile?.efficiencyAnalysisEnabled) {
        return;
      }

      const dbPath = this.dependencies.getProfileStateDbPath(
        profile.userDataDir
      );
      const headersRaw = await this.dependencies.readItemTableKey(
        dbPath,
        COMPOSER_HEADERS_KEY,
        this.extensionPath
      );
      const headers = parseComposerHeaders(headersRaw);
      if (!headers?.allComposers?.length) {
        return;
      }

      const state = this.loadState();
      if (!state.enabledAt) {
        state.enabledAt = new Date(this.dependencies.now()).toISOString();
        await this.seedExistingBubbles(dbPath, headers.allComposers, state);
        await this.saveState(state);
        return;
      }

      const enabledAtMs = Date.parse(state.enabledAt);
      const catalog = await this.loadModelCatalog(dbPath);

      for (const header of headers.allComposers) {
        await this.processComposer(
          dbPath,
          header,
          state,
          profile,
          enabledAtMs,
          catalog
        );
      }

      await this.saveState(state);
    } catch (error) {
      extensionLog.debug(
        `[ComposerDbPoller] Tick skipped: ${extensionLog.formatError(error)}`
      );
    } finally {
      this.ticking = false;
    }
  }

  private async seedExistingBubbles(
    dbPath: string,
    composers: ComposerHeaderEntry[],
    state: DbPollerState
  ): Promise<void> {
    for (const header of composers) {
      const composerId = header.composerId;
      if (!composerId) {
        continue;
      }

      const dataRaw = await this.dependencies.readCursorDiskKV(
        dbPath,
        composerDataKey(composerId),
        this.extensionPath
      );
      const data = parseComposerData(dataRaw);
      for (const bubbleHeader of getUserBubbleHeaders(data)) {
        markBubbleSeen(state, composerId, bubbleHeader.bubbleId);
      }

      if (typeof header.lastUpdatedAt === 'number') {
        state.lastUpdatedAtByComposer[composerId] = header.lastUpdatedAt;
      }
    }

    extensionLog.info(
      `[ComposerDbPoller] Seeded ${composers.length} composer(s); new prompts only from now`
    );
  }

  private async loadModelCatalog(dbPath: string): Promise<ModelCatalogEntry[]> {
    const raw = await this.dependencies.readItemTableKey(
      dbPath,
      APPLICATION_USER_KEY,
      this.extensionPath
    );
    return parseModelCatalog(raw);
  }

  private async processComposer(
    dbPath: string,
    header: ComposerHeaderEntry,
    state: DbPollerState,
    profile: Profile,
    enabledAtMs: number,
    catalog: ModelCatalogEntry[]
  ): Promise<void> {
    const composerId = header.composerId;
    if (!composerId) {
      return;
    }

    const lastUpdated = header.lastUpdatedAt ?? 0;
    const watermark = state.lastUpdatedAtByComposer[composerId] ?? 0;
    if (lastUpdated <= watermark) {
      return;
    }

    const dataRaw = await this.dependencies.readCursorDiskKV(
      dbPath,
      composerDataKey(composerId),
      this.extensionPath
    );
    const data = parseComposerData(dataRaw);
    const resolved = resolveModelConfig(data?.modelConfig, catalog);
    const model = resolved.slug;
    extensionLog.debug(
      `[ComposerDbPoller] Model ${resolved.baseModelId} → ${resolved.slug} (resolved=${resolved.resolved}, maxMode=${resolved.maxMode}, params=${JSON.stringify(resolved.parameters)})`
    );
    const workspaceRoots = extractWorkspaceRoots(header);
    const workspaceRoot = workspaceRoots[0];
    const gitBranch = workspaceRoot
      ? await this.dependencies.branchDetector.getCurrentBranch(workspaceRoot)
      : undefined;

    for (const bubbleHeader of getUserBubbleHeaders(data)) {
      const bubbleId = bubbleHeader.bubbleId;
      if (isBubbleSeen(state, composerId, bubbleId)) {
        continue;
      }

      markBubbleSeen(state, composerId, bubbleId);

      const bubbleRaw = await this.dependencies.readCursorDiskKV(
        dbPath,
        bubbleIdKey(composerId, bubbleId),
        this.extensionPath
      );
      const metadata = buildPromptMetadata(parseBubbleRow(bubbleRaw), {
        composerId,
        profileEmail: profile.email,
        model,
        modelResolved: resolved.resolved,
        workspaceRoots,
        gitBranch,
        lastUpdated,
        enabledAtMs,
      });
      if (!metadata) {
        continue;
      }

      extensionLog.info(
        `[ComposerDbPoller] New user prompt in ${composerId.slice(0, 8)}…`
      );
      this.analyzer.enqueue(metadata);
    }

    state.lastUpdatedAtByComposer[composerId] = lastUpdated;
  }
}
