import * as vscode from 'vscode';
import * as extensionLog from '../logging/extensionLog';
import { isEnterpriseUsage } from '../domain';
import type { QuotaUsage } from '../domain';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import { getCursorAccountsConfig } from '../config';
import { t } from '../l10n';
import type { Profile } from '../profiles/types';
import {
  buildQuotaText,
  buildQuotaTooltip,
  getProgressPercent,
  getStatusBarBackground,
} from './statusBarPresentation';
import { appendProfileSuffix } from '../utils/statusBarLabel';

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
    const showProfileName = cfg.showProfileInStatusBar;
    const profileName = this.activeProfile?.displayName;

    this.quotaItem.command = 'cursorAccounts.openAccounts';

    if (!this.activeProfile) {
      this.quotaItem.text = `$(account) ${t('statusBar.selectAccount')}`;
      this.quotaItem.tooltip = t('statusBar.selectAccountTooltip');
      this.quotaItem.backgroundColor = undefined;
      this.quotaItem.show();
      return;
    }

    const cached = usageOverride ?? this.readCache();
    const isEnterprise = cached ? isEnterpriseUsage(cached) : false;
    const showQuota = isEnterprise ? cfg.showTotal : cfg.showTotal || cfg.showIncluded;

    if (!showQuota && !showProfileName) {
      this.quotaItem.hide();
      return;
    }

    if (!showQuota) {
      this.quotaItem.text = `$(account) ${profileName}`;
      this.quotaItem.tooltip = this.buildProfileTooltip(this.activeProfile);
      this.quotaItem.backgroundColor = undefined;
      this.quotaItem.show();
      return;
    }

    if (this.quotaLoading) {
      const base = isEnterprise
        ? t('statusBar.loadingMonthlyUsage')
        : t('statusBar.loadingUsage');
      this.quotaItem.text = appendProfileSuffix(base, profileName, showProfileName);
      this.quotaItem.tooltip = isEnterprise
        ? t('statusBar.loadingMonthlyUsageTooltip')
        : t('statusBar.loadingUsageTooltip');
      this.quotaItem.backgroundColor = undefined;
      this.quotaItem.show();
      return;
    }

    if (this.quotaError) {
      const base = t('statusBar.quotaUnavailable');
      this.quotaItem.text = appendProfileSuffix(base, profileName, showProfileName);
      this.quotaItem.tooltip = this.quotaError;
      this.quotaItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
      this.quotaItem.show();
      return;
    }

    if (!cached) {
      this.quotaItem.hide();
      return;
    }

    this.quotaItem.text = buildQuotaText(cached, profileName, showProfileName);
    const tooltip = new vscode.MarkdownString(
      buildQuotaTooltip(cached, cfg.showAccountEmail),
      true
    );
    tooltip.isTrusted = true;
    this.quotaItem.tooltip = tooltip;
    const background = getStatusBarBackground(
      getProgressPercent(cached)
    );
    this.quotaItem.backgroundColor = background
      ? new vscode.ThemeColor(`statusBarItem.${background}Background`)
      : undefined;
    this.quotaItem.show();
  }

  private buildProfileTooltip(profile: Profile): string | vscode.MarkdownString {
    return t('statusBar.profileActiveTooltip', {
      name: profile.displayName,
      email: profile.email,
    });
  }

  private readCache(): QuotaUsage | undefined {
    return this.context.globalState.get<QuotaUsage>('lastQuota');
  }

}
