import * as vscode from 'vscode';
import * as extensionLog from '../logging/extensionLog';
import { QuotaUsage } from '../api/types';
import { getCursorAccountsConfig } from '../config';
import { ProfileDetector } from '../profiles/profileDetector';
import {
  clampPercent,
  formatBillingDate,
  formatCents,
  formatPercent,
  renderProgressBar,
} from '../utils/formatters';

const PROFILE_PRIORITY = 102;
const INCLUDED_PRIORITY = 101;
const TOTAL_PRIORITY = 100;

export class StatusBarManager {
  private readonly profileItem?: vscode.StatusBarItem;
  private readonly includedItem: vscode.StatusBarItem;
  private readonly totalItem: vscode.StatusBarItem;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileDetector?: ProfileDetector
  ) {
    if (profileDetector) {
      this.profileItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        PROFILE_PRIORITY
      );
      this.profileItem.name = 'cursorAccounts.profile';
      this.profileItem.command = 'cursorAccounts.showCurrentProfile';
      this.profileItem.tooltip = 'Click to see current profile details';
      context.subscriptions.push(this.profileItem);
    }

    this.includedItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      INCLUDED_PRIORITY
    );
    this.includedItem.name = 'cursorAccounts.included';
    this.includedItem.command = 'cursorAccounts.openUsage';

    this.totalItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      TOTAL_PRIORITY
    );
    this.totalItem.name = 'cursorAccounts.total';
    this.totalItem.command = 'cursorAccounts.openUsage';

    context.subscriptions.push(this.includedItem, this.totalItem);
  }

  showOnActivate(): void {
    void this.updateProfileIndicator();

    const cached = this.readCache();
    if (cached) {
      this.render(cached);
    } else {
      this.showLoading();
    }
  }

  showLoading(): void {
    const cfg = getCursorAccountsConfig();
    if (cfg.showIncluded) {
      this.includedItem.text = '$(sync~spin) Included quota…';
      this.includedItem.tooltip = 'Loading Cursor included quota usage…';
      this.includedItem.backgroundColor = undefined;
      this.includedItem.show();
    } else {
      this.includedItem.hide();
    }

    if (cfg.showTotal) {
      this.totalItem.text = '$(sync~spin) Plan quota…';
      this.totalItem.tooltip = 'Loading Cursor plan quota usage…';
      this.totalItem.backgroundColor = undefined;
      this.totalItem.show();
    } else {
      this.totalItem.hide();
    }
  }

  render(usage: QuotaUsage): void {
    const cfg = getCursorAccountsConfig();
    const includedPct = clampPercent(usage.apiPercentUsed);
    const totalPct = clampPercent(usage.totalPercentUsed);
    const tooltip = this.buildTooltip(usage, cfg.showAccountEmail);

    if (cfg.showIncluded) {
      const bar = renderProgressBar(includedPct);
      this.includedItem.text = `$(graph) ${bar} ${formatPercent(includedPct)} included`;
      this.includedItem.tooltip = tooltip;
      this.includedItem.backgroundColor = backgroundForPercent(includedPct);
      this.includedItem.show();
    } else {
      this.includedItem.hide();
    }

    if (cfg.showTotal) {
      const bar = renderProgressBar(totalPct);
      this.totalItem.text = `$(pulse) ${bar} ${formatPercent(totalPct)} plan`;
      this.totalItem.tooltip = tooltip;
      this.totalItem.backgroundColor = backgroundForPercent(totalPct);
      this.totalItem.show();
    } else {
      this.totalItem.hide();
    }

    void this.context.globalState.update('lastQuota', usage);
  }

  showError(message: string): void {
    const cfg = getCursorAccountsConfig();
    const text = `$(warning) Quota unavailable`;

    if (cfg.showIncluded) {
      this.includedItem.text = text;
      this.includedItem.tooltip = message;
      this.includedItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
      this.includedItem.show();
    }

    if (cfg.showTotal) {
      this.totalItem.text = text;
      this.totalItem.tooltip = message;
      this.totalItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
      this.totalItem.show();
    }
  }

  applyVisibilityFromConfig(): void {
    void this.updateProfileIndicator();

    const cached = this.readCache();
    if (cached) {
      this.render(cached);
    } else {
      this.showLoading();
    }
  }

  async updateProfileIndicator(): Promise<void> {
    if (!this.profileDetector || !this.profileItem) {
      return;
    }

    try {
      const profile = await this.profileDetector.detectCurrentProfile();
      const cfg = getCursorAccountsConfig();

      if (!cfg.showProfileInStatusBar) {
        this.profileItem.hide();
        return;
      }

      if (profile) {
        this.profileItem.text = `$(account) ${profile.displayName}`;
        this.profileItem.tooltip = `Profile: ${profile.displayName}\nEmail: ${profile.email}\n\nClick for details`;
        this.profileItem.show();
      } else {
        this.profileItem.text = '$(account) Default';
        this.profileItem.tooltip =
          'Using default Cursor profile\n\nClick for details';
        this.profileItem.show();
      }
    } catch (error) {
      extensionLog.error(
        `[StatusBarManager] Failed to update profile indicator: ${extensionLog.formatError(error)}`
      );
      this.profileItem.hide();
    }
  }

  private readCache(): QuotaUsage | undefined {
    return this.context.globalState.get<QuotaUsage>('lastQuota');
  }

  private buildTooltip(
    usage: QuotaUsage,
    showEmail: boolean
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;

    md.appendMarkdown('### Cursor plan quota\n\n');
    if (showEmail && usage.accountEmail) {
      md.appendMarkdown(`**Account:** ${usage.accountEmail}\n\n`);
    }

    md.appendMarkdown(
      `| | |\n|---|---|\n` +
        `| **Total plan used** | ${formatPercent(usage.totalPercentUsed)} |\n` +
        `| **Included (API) used** | ${formatPercent(usage.apiPercentUsed)} |\n` +
        `| **Auto mode used** | ${formatPercent(usage.autoPercentUsed)} |\n` +
        `| **Spend** | ${formatCents(usage.totalSpend)} / ${formatCents(usage.limit)} |\n` +
        `| **Included spend** | ${formatCents(usage.includedSpend)} |\n` +
        `| **Remaining** | ${formatCents(usage.remaining)} |\n` +
        `| **Billing cycle** | ${formatBillingDate(usage.billingCycleStart)} → ${formatBillingDate(usage.billingCycleEnd)} |\n`
    );

    if (usage.displayMessage) {
      md.appendMarkdown(`\n_${usage.displayMessage}_\n`);
    }

    md.appendMarkdown(
      '\n\nClick to open **Cursor Settings → Usage**. Use **Cursor Accounts: Refresh Now** to update.'
    );
    return md;
  }
}

function backgroundForPercent(
  percent: number
): vscode.ThemeColor | undefined {
  if (percent >= 95) {
    return new vscode.ThemeColor('statusBarItem.errorBackground');
  }
  if (percent >= 85) {
    return new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  return undefined;
}
