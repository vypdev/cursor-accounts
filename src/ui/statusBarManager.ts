import * as vscode from 'vscode';
import * as extensionLog from '../logging/extensionLog';
import type { QuotaUsage } from '../domain';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import { getCursorAccountsConfig } from '../config';
import type { Profile } from '../profiles/types';
import {
  resolveStatusBarDisplay,
  type StatusBarDisplay,
} from './statusBarDisplayPolicy';

const QUOTA_ITEM_PRIORITY = 100;

export class StatusBarManager {
  private readonly quotaItem: vscode.StatusBarItem;
  private activeProfile: Profile | null = null;
  private quotaLoading = false;
  private quotaError: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileDetector?: IProfileDetector
  ) {
    this.quotaItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      QUOTA_ITEM_PRIORITY
    );
    this.quotaItem.name = 'cursorAccounts.quota';
    this.quotaItem.command = 'cursorAccounts.openAccounts';
    context.subscriptions.push(this.quotaItem);
  }

  showOnActivate(): void {
    void this.updateProfileIndicator().then(() => {
      const cached = this.readCache();
      if (cached) {
        this.render(cached);
      } else {
        this.showLoading();
      }
    });
  }

  showLoading(): void {
    this.quotaLoading = true;
    this.quotaError = undefined;
    this.refreshDisplay();
  }

  render(usage: QuotaUsage): void {
    this.quotaLoading = false;
    this.quotaError = undefined;
    void this.context.globalState.update('lastQuota', usage);
    this.refreshDisplay(usage);
  }

  showError(message: string): void {
    this.quotaLoading = false;
    this.quotaError = message;
    this.refreshDisplay();
  }

  applyVisibilityFromConfig(): void {
    void this.updateProfileIndicator().then(() => {
      const cached = this.readCache();
      if (cached) {
        this.render(cached);
      } else {
        this.showLoading();
      }
    });
  }

  async updateProfileIndicator(): Promise<void> {
    if (!this.profileDetector) {
      return;
    }

    try {
      this.activeProfile = await this.profileDetector.detectCurrentProfile();
    } catch (error) {
      extensionLog.error(
        `[StatusBarManager] Failed to update profile indicator: ${extensionLog.formatError(error)}`
      );
      this.activeProfile = null;
    }

    this.refreshDisplay();
  }

  private refreshDisplay(usageOverride?: QuotaUsage): void {
    const cfg = getCursorAccountsConfig();
    const display = resolveStatusBarDisplay({
      activeProfile: this.activeProfile,
      cachedUsage: usageOverride ?? this.readCache(),
      quotaLoading: this.quotaLoading,
      quotaError: this.quotaError,
      showProfileName: cfg.showProfileInStatusBar,
      showIncluded: cfg.showIncluded,
      showTotal: cfg.showTotal,
      showAccountEmail: cfg.showAccountEmail,
    });
    this.renderDisplay(display);
  }

  private renderDisplay(display: StatusBarDisplay): void {
    this.quotaItem.command = 'cursorAccounts.openAccounts';

    if (display.kind === 'hidden') {
      this.quotaItem.hide();
      return;
    }

    this.quotaItem.text = display.text;
    this.quotaItem.tooltip =
      display.tooltipKind === 'markdown'
        ? this.createMarkdownTooltip(display.tooltip)
        : display.tooltip;
    this.quotaItem.backgroundColor = display.background
      ? new vscode.ThemeColor(`statusBarItem.${display.background}Background`)
      : undefined;
    this.quotaItem.show();
  }

  private createMarkdownTooltip(markdown: string): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString(markdown, true);
    tooltip.isTrusted = true;
    return tooltip;
  }

  private readCache(): QuotaUsage | undefined {
    return this.context.globalState.get<QuotaUsage>('lastQuota');
  }

}
