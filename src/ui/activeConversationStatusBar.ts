import * as vscode from 'vscode';
import type { ConversationTokenTotals } from '../application/types/agentPersistence';
import type { ActiveConversationState } from '../application/types/activeConversation';
import type { ActiveConversationTracker } from '../services/activeConversationTracker';
import { buildActiveConversationStatusBarDisplay } from './presentation/activeConversationStatusBarPresentation';

export {
  formatContextPercent,
  resolveConversationDisplayTotals,
} from './presentation/activeConversationStatusBarPresentation';

/** Left of live agent usage (priority 99) and quota (100). */
const STATUS_PRIORITY = 98;
const DISPLAY_THROTTLE_MS = 150;

export type ConversationTotalsLoader = (
  conversationId: string,
  profileId?: string
) => Promise<ConversationTokenTotals | null>;

export class ActiveConversationStatusBar {
  private readonly item: vscode.StatusBarItem;
  private currentState: ActiveConversationState | null = null;
  private currentTotals: ConversationTokenTotals | null = null;
  private lastProfileId: string | undefined;
  private unsubscribe?: () => void;
  private refreshThrottleTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshGeneration = 0;

  constructor(
    context: vscode.ExtensionContext,
    private readonly tracker: ActiveConversationTracker,
    private readonly loadTotals: ConversationTotalsLoader
  ) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      STATUS_PRIORITY
    );
    this.item.name = 'cursorAccounts.activeConversation';
    this.item.command = 'cursorAccounts.debug.copyActiveConversationId';
    context.subscriptions.push(this.item);
    context.subscriptions.push({
      dispose: () => this.dispose(),
    });

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('cursorAccounts.debug')) {
          this.applyVisibility();
        }
      })
    );
  }

  start(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.tracker.onChange((state) => {
      this.currentState = state;
      void this.refreshTotals();
    });
    this.applyVisibility();
    void this.tracker.tickNow();
  }

  notifyUsagePersisted(conversationId: string, profileId?: string): void {
    if (profileId) {
      this.lastProfileId = profileId;
    }
    const activeId = this.currentState?.lastFocusedComposerId;
    if (!activeId || activeId !== conversationId) {
      return;
    }
    this.scheduleThrottledRefresh();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.refreshThrottleTimer) {
      clearTimeout(this.refreshThrottleTimer);
      this.refreshThrottleTimer = undefined;
    }
    this.item.hide();
  }

  getCurrentState(): ActiveConversationState | null {
    return this.currentState;
  }

  getCurrentTotals(): ConversationTokenTotals | null {
    return this.currentTotals;
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('cursorAccounts.debug')
      .get<boolean>('showActiveConversationInStatusBar', true);
  }

  private applyVisibility(): void {
    if (!this.isEnabled()) {
      this.item.hide();
      return;
    }
    this.refreshDisplay();
  }

  private scheduleThrottledRefresh(): void {
    if (this.refreshThrottleTimer) {
      return;
    }
    this.refreshThrottleTimer = setTimeout(() => {
      this.refreshThrottleTimer = undefined;
      void this.refreshTotals();
    }, DISPLAY_THROTTLE_MS);
  }

  private async refreshTotals(): Promise<void> {
    if (!this.isEnabled()) {
      this.item.hide();
      return;
    }

    const conversationId = this.currentState?.lastFocusedComposerId;
    if (!conversationId) {
      this.currentTotals = null;
      this.refreshDisplay();
      return;
    }

    const generation = ++this.refreshGeneration;
    try {
      const totals = await this.loadTotals(conversationId, this.lastProfileId);
      if (generation !== this.refreshGeneration) {
        return;
      }
      this.currentTotals = totals;
    } catch {
      if (generation !== this.refreshGeneration) {
        return;
      }
      this.currentTotals = null;
    }
    this.refreshDisplay();
  }

  private refreshDisplay(): void {
    if (!this.isEnabled()) {
      this.item.hide();
      return;
    }

    const display = buildActiveConversationStatusBarDisplay(
      this.currentState,
      this.currentTotals
    );
    this.item.text = display.text;
    this.item.tooltip = display.tooltip;
    this.item.backgroundColor = display.showWarning
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    this.item.show();
  }
}
