import * as vscode from 'vscode';
import * as extensionLog from '../logging/extensionLog';
import type {
  QuotaUsage} from '../api/types';
import {
  getEffectiveUsagePercent,
  getPersonalModeAveragePercent,
  isEnterpriseUsage,
} from '../api/types';
import { getCursorAccountsConfig } from '../config';
import { t } from '../l10n';
import type { ProfileDetector } from '../profiles/profileDetector';
import type { Profile } from '../profiles/types';
import {
  clampPercent,
  formatBillingDate,
  formatCents,
  formatMonthlySpend,
  formatPercent,
  renderProgressBar,
} from '../utils/formatters';
import { appendProfileSuffix } from '../utils/statusBarLabel';

const QUOTA_ITEM_PRIORITY = 100;

export class StatusBarManager {
  private readonly quotaItem: vscode.StatusBarItem;
  private activeProfile: Profile | null = null;
  private quotaLoading = false;
  private quotaError: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileDetector?: ProfileDetector
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
    const isEnterprise = isEnterpriseUsage(cached);
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

    const isMonthlySpend = cached.displayMode === 'monthlySpend';
    const isPersonalPercent = !isEnterprise && !isMonthlySpend;
    const effectivePct = clampPercent(getEffectiveUsagePercent(cached));
    const averagePct = clampPercent(getPersonalModeAveragePercent(cached));
    const barPct = isEnterprise || isMonthlySpend ? effectivePct : averagePct;
    const bar = renderProgressBar(barPct);

    let baseText: string;
    if (isEnterprise && isMonthlySpend) {
      const spend = cached.monthlySpend ?? cached.totalSpend;
      const limit = cached.monthlyLimit;
      baseText = `$(pulse) ${bar} ${formatPercent(effectivePct)} · ${formatMonthlySpend(spend, limit)}`;
    } else if (isMonthlySpend) {
      const spend = cached.monthlySpend ?? cached.totalSpend;
      const limit = cached.monthlyLimit;
      baseText = `$(pulse) ${bar} ${formatMonthlySpend(spend, limit)} ${t('statusBar.monthlySuffix')}`;
    } else if (isPersonalPercent) {
      baseText = `$(pulse) ${bar} ${formatPercent(averagePct)} ${t('statusBar.usageSuffix')}`;
    } else {
      baseText = `$(pulse) ${bar} ${formatPercent(effectivePct)} ${t('statusBar.planSuffix')}`;
    }

    this.quotaItem.text = appendProfileSuffix(baseText, profileName, showProfileName);
    this.quotaItem.tooltip = this.buildTooltip(cached, cfg.showAccountEmail);
    this.quotaItem.backgroundColor = backgroundForPercent(barPct);
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

  private buildTooltip(
    usage: QuotaUsage,
    showEmail: boolean
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;

    const isMonthlySpend = usage.displayMode === 'monthlySpend';
    const title = isMonthlySpend
      ? t('statusBar.tooltipMonthlyTitle')
      : t('statusBar.tooltipQuotaTitle');
    md.appendMarkdown(`### ${title}\n\n`);

    if (showEmail && usage.accountEmail) {
      md.appendMarkdown(
        t('statusBar.tooltipAccount', { email: usage.accountEmail }) + '\n\n'
      );
    }

    if (usage.membershipType) {
      md.appendMarkdown(
        t('statusBar.tooltipPlan', { plan: usage.membershipType }) + '\n\n'
      );
    }

    if (isMonthlySpend) {
      const spend = usage.monthlySpend ?? usage.totalSpend;
      const limit = usage.monthlyLimit;
      md.appendMarkdown(
        `| | |\n|---|---|\n` +
          t('statusBar.tooltipMonthlySpend', {
            value: formatMonthlySpend(spend, limit),
          }) +
          '\n' +
          t('statusBar.tooltipUsedOnDemand', {
            value: formatCents(spend),
          }) +
          '\n' +
          t('statusBar.tooltipLimit', {
            value: limit == null ? t('formatters.unlimited') : formatCents(limit),
          }) +
          '\n' +
          t('statusBar.tooltipRemaining', {
            value: formatCents(usage.remaining),
          }) +
          '\n' +
          t('statusBar.tooltipBillingCycle', {
            start: formatBillingDate(usage.billingCycleStart),
            end: formatBillingDate(usage.billingCycleEnd),
          }) +
          '\n'
      );

      if (usage.teamMonthlySpend != null) {
        md.appendMarkdown(
          t('statusBar.tooltipTeamPoolSpend', {
            value: formatMonthlySpend(
              usage.teamMonthlySpend,
              usage.teamMonthlyLimit
            ),
          }) + '\n'
        );
      }
    } else {
      md.appendMarkdown(
        `| | |\n|---|---|\n` +
          t('statusBar.tooltipTotalPlanUsed', {
            value: formatPercent(usage.totalPercentUsed),
          }) +
          '\n' +
          t('statusBar.tooltipIncludedApiUsed', {
            value: formatPercent(usage.apiPercentUsed),
          }) +
          '\n' +
          t('statusBar.tooltipAutoModeUsed', {
            value: formatPercent(usage.autoPercentUsed),
          }) +
          '\n' +
          t('statusBar.tooltipSpend', {
            value: `${formatCents(usage.totalSpend)} / ${formatCents(usage.limit)}`,
          }) +
          '\n' +
          t('statusBar.tooltipIncludedSpend', {
            value: formatCents(usage.includedSpend),
          }) +
          '\n' +
          t('statusBar.tooltipRemaining', {
            value: formatCents(usage.remaining),
          }) +
          '\n' +
          t('statusBar.tooltipBillingCycle', {
            start: formatBillingDate(usage.billingCycleStart),
            end: formatBillingDate(usage.billingCycleEnd),
          }) +
          '\n'
      );
    }

    if (usage.displayMessage) {
      md.appendMarkdown(`\n_${usage.displayMessage}_\n`);
    }

    md.appendMarkdown(t('statusBar.tooltipClickToOpen'));
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
