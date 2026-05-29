import * as vscode from 'vscode';
import * as extensionLog from '../logging/extensionLog';
import { QuotaUsage, getEffectiveUsagePercent, getPersonalModeAveragePercent, isEnterpriseUsage } from '../api/types';
import { getCursorAccountsConfig } from '../config';
import { t } from '../l10n';
import { ProfileDetector } from '../profiles/profileDetector';
import {
  clampPercent,
  formatBillingDate,
  formatCents,
  formatMonthlySpend,
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
      this.profileItem.tooltip = t('statusBar.profileTooltip');
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
    const cached = this.readCache();
    const isEnterprise = isEnterpriseUsage(cached);
    const showPersonalQuota = cfg.showTotal || cfg.showIncluded;

    this.includedItem.hide();

    if (isEnterprise ? cfg.showTotal : showPersonalQuota) {
      this.totalItem.text = isEnterprise
        ? t('statusBar.loadingMonthlyUsage')
        : t('statusBar.loadingUsage');
      this.totalItem.tooltip = isEnterprise
        ? t('statusBar.loadingMonthlyUsageTooltip')
        : t('statusBar.loadingUsageTooltip');
      this.totalItem.backgroundColor = undefined;
      this.totalItem.show();
    } else {
      this.totalItem.hide();
    }
  }

  render(usage: QuotaUsage): void {
    const cfg = getCursorAccountsConfig();
    const isEnterprise = isEnterpriseUsage(usage);
    const isMonthlySpend = usage.displayMode === 'monthlySpend';
    const isPersonalPercent = !isEnterprise && !isMonthlySpend;
    const effectivePct = clampPercent(getEffectiveUsagePercent(usage));
    const averagePct = clampPercent(getPersonalModeAveragePercent(usage));
    const showPersonalQuota = cfg.showTotal || cfg.showIncluded;
    const tooltip = this.buildTooltip(usage, cfg.showAccountEmail);

    this.includedItem.hide();

    if (isEnterprise ? cfg.showTotal : showPersonalQuota) {
      const barPct = isEnterprise || isMonthlySpend ? effectivePct : averagePct;
      const bar = renderProgressBar(barPct);

      if (isEnterprise && isMonthlySpend) {
        const spend = usage.monthlySpend ?? usage.totalSpend;
        const limit = usage.monthlyLimit;
        this.totalItem.text = `$(pulse) ${bar} ${formatPercent(effectivePct)} · ${formatMonthlySpend(spend, limit)}`;
      } else if (isMonthlySpend) {
        const spend = usage.monthlySpend ?? usage.totalSpend;
        const limit = usage.monthlyLimit;
        this.totalItem.text = `$(pulse) ${bar} ${formatMonthlySpend(spend, limit)} ${t('statusBar.monthlySuffix')}`;
      } else if (isPersonalPercent) {
        this.totalItem.text = `$(pulse) ${bar} ${formatPercent(averagePct)} ${t('statusBar.usageSuffix')}`;
      } else {
        this.totalItem.text = `$(pulse) ${bar} ${formatPercent(effectivePct)} ${t('statusBar.planSuffix')}`;
      }

      this.totalItem.tooltip = tooltip;
      this.totalItem.backgroundColor = backgroundForPercent(barPct);
      this.totalItem.show();
    } else {
      this.totalItem.hide();
    }

    void this.context.globalState.update('lastQuota', usage);
  }

  showError(message: string): void {
    const cfg = getCursorAccountsConfig();
    const text = t('statusBar.quotaUnavailable');
    const cached = this.readCache();
    const isEnterprise = isEnterpriseUsage(cached);
    const showPersonalQuota = cfg.showTotal || cfg.showIncluded;

    this.includedItem.hide();

    if (isEnterprise ? cfg.showTotal : showPersonalQuota) {
      this.totalItem.text = text;
      this.totalItem.tooltip = message;
      this.totalItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
      this.totalItem.show();
    } else {
      this.totalItem.hide();
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
        this.profileItem.tooltip = t('statusBar.profileActiveTooltip', {
          name: profile.displayName,
          email: profile.email,
        });
        this.profileItem.show();
      } else {
        this.profileItem.text = t('statusBar.profileDefault');
        this.profileItem.tooltip = t('statusBar.defaultProfileTooltip');
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
