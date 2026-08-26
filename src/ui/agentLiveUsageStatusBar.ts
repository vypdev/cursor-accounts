import * as vscode from 'vscode';
import {
  AgentLiveUsageState,
  type AgentLiveUsageSessionState,
} from '../application/services/agentLiveUsageState';
import { ProxyLiveCostCalculator } from '../domain/services/ProxyLiveCostCalculator';
import { CursorModelPricingProvider } from '../modelEfficiency/cursorModelPricingProvider';
import { mergeAgentSessionInfo } from '../proxy/proxyInsightExtractor';
import type { ProxyTrafficSummary } from '../proxy/types';
import { buildAgentLiveUsageDisplay } from './presentation/agentLiveUsagePresentation';

const IDLE_HIDE_MS = 300_000;
/** Just left of quota item (priority 100). */
const STATUS_PRIORITY = 99;
/** Throttle status bar redraws during token_delta bursts (CLI uses ~de.Zx ms). */
const DISPLAY_THROTTLE_MS = 150;

/**
 * Live agent/chat token usage in the status bar (requires MITM proxy + live API traffic).
 */
export class AgentLiveUsageStatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly costCalculator: ProxyLiveCostCalculator;
  private readonly usageState: AgentLiveUsageState;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshThrottleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.costCalculator = new ProxyLiveCostCalculator(
      new CursorModelPricingProvider(),
      () =>
        vscode.workspace
          .getConfiguration('cursorAccounts.proxy')
          .get<number>('estimatedDollarsPerMillionTokens', 4)
    );
    this.usageState = new AgentLiveUsageState({
      mergeAgentSessionInfo,
      costCalculator: this.costCalculator,
    });

    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      STATUS_PRIORITY
    );
    this.item.name = 'cursorAccounts.agentLiveUsage';
    this.item.command = 'cursorAccounts.proxy.showOutput';
    context.subscriptions.push(this.item);
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('cursorAccounts.proxy')) {
          this.refreshDisplay();
        }
      })
    );
    context.subscriptions.push({ dispose: () => this.dispose() });
  }

  private get sessions(): ReadonlyMap<string, AgentLiveUsageSessionState> {
    return this.usageState.sessions;
  }

  ingest(summary: ProxyTrafficSummary): void {
    if (!this.isEnabled()) {
      return;
    }
    if (!this.usageState.ingest(summary)) {
      return;
    }

    if (summary.isLiveTokenUpdate) {
      this.scheduleThrottledRefresh();
    } else {
      this.refreshDisplay();
    }
    this.scheduleIdleHide();
  }

  clear(): void {
    this.usageState.clear();
    this.item.backgroundColor = undefined;
    this.item.hide();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (this.refreshThrottleTimer) {
      clearTimeout(this.refreshThrottleTimer);
      this.refreshThrottleTimer = undefined;
    }
  }

  dispose(): void {
    this.clear();
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('cursorAccounts.proxy')
      .get<boolean>('showLiveUsageInStatusBar', true);
  }

  private scheduleThrottledRefresh(): void {
    if (this.refreshThrottleTimer) {
      return;
    }
    this.refreshThrottleTimer = setTimeout(() => {
      this.refreshThrottleTimer = undefined;
      this.refreshDisplay();
    }, DISPLAY_THROTTLE_MS);
  }

  private refreshDisplay(): void {
    const display = buildAgentLiveUsageDisplay(this.sessions, this.isEnabled());
    if (!display.visible) {
      this.item.hide();
      return;
    }
    this.item.text = display.text;
    this.item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
    this.item.tooltip = display.tooltip;
    this.item.show();
  }

  private scheduleIdleHide(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.clear();
    }, IDLE_HIDE_MS);
  }
}
