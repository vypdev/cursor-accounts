import type { QuotaUsage } from '../domain';
import {
  getEffectiveUsagePercent,
  getPersonalModeAveragePercent,
  isEnterpriseUsage,
} from '../domain';
import { t } from '../l10n';
import {
  clampPercent,
  formatBillingDate,
  formatCents,
  formatMonthlySpend,
  formatPercent,
  renderProgressBar,
} from '../utils/formatters';
import { appendProfileSuffix } from '../utils/statusBarLabel';

export type StatusBarBackground = 'warning' | 'error' | undefined;

export function getProgressPercent(usage: QuotaUsage): number {
  const isEnterprise = isEnterpriseUsage(usage);
  const isMonthlySpend = usage.displayMode === 'monthlySpend';
  const effectivePct = clampPercent(getEffectiveUsagePercent(usage));
  const averagePct = clampPercent(getPersonalModeAveragePercent(usage));
  return isEnterprise || isMonthlySpend ? effectivePct : averagePct;
}

/** Build the quota text without depending on the VS Code rendering API. */
export function buildQuotaText(
  usage: QuotaUsage,
  profileName: string | undefined,
  showProfileName: boolean
): string {
  const isMonthlySpend = usage.displayMode === 'monthlySpend';
  const isEnterprise = isEnterpriseUsage(usage);
  const isPersonalPercent = !isEnterprise && !isMonthlySpend;
  const effectivePct = clampPercent(getEffectiveUsagePercent(usage));
  const averagePct = clampPercent(getPersonalModeAveragePercent(usage));
  const barPct = getProgressPercent(usage);
  const bar = renderProgressBar(barPct);

  let baseText: string;
  if (isEnterprise && isMonthlySpend) {
    const spend = usage.monthlySpend ?? usage.totalSpend;
    const limit = usage.monthlyLimit;
    baseText = `$(pulse) ${bar} ${formatPercent(effectivePct)} · ${formatMonthlySpend(spend, limit)}`;
  } else if (isMonthlySpend) {
    const spend = usage.monthlySpend ?? usage.totalSpend;
    const limit = usage.monthlyLimit;
    baseText = `$(pulse) ${bar} ${formatMonthlySpend(spend, limit)} ${t('statusBar.monthlySuffix')}`;
  } else if (isPersonalPercent) {
    baseText = `$(pulse) ${bar} ${formatPercent(averagePct)} ${t('statusBar.usageSuffix')}`;
  } else {
    baseText = `$(pulse) ${bar} ${formatPercent(effectivePct)} ${t('statusBar.planSuffix')}`;
  }

  return appendProfileSuffix(baseText, profileName, showProfileName);
}

/** Build the Markdown source for the quota tooltip. */
export function buildQuotaTooltip(
  usage: QuotaUsage,
  showEmail: boolean
): string {
  const isMonthlySpend = usage.displayMode === 'monthlySpend';
  const title = isMonthlySpend
    ? t('statusBar.tooltipMonthlyTitle')
    : t('statusBar.tooltipQuotaTitle');
  let markdown = `### ${title}\n\n`;

  if (showEmail && usage.accountEmail) {
    markdown +=
      t('statusBar.tooltipAccount', { email: usage.accountEmail }) + '\n\n';
  }

  if (usage.membershipType) {
    markdown +=
      t('statusBar.tooltipPlan', { plan: usage.membershipType }) + '\n\n';
  }

  if (isMonthlySpend) {
    const spend = usage.monthlySpend ?? usage.totalSpend;
    const limit = usage.monthlyLimit;
    markdown +=
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
      '\n';

    if (usage.teamMonthlySpend != null) {
      markdown +=
        t('statusBar.tooltipTeamPoolSpend', {
          value: formatMonthlySpend(
            usage.teamMonthlySpend,
            usage.teamMonthlyLimit
          ),
        }) + '\n';
    }
  } else {
    markdown +=
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
      '\n';
  }

  if (usage.displayMessage) {
    markdown += `\n_${usage.displayMessage}_\n`;
  }

  return markdown + t('statusBar.tooltipClickToOpen');
}

export function getStatusBarBackground(percent: number): StatusBarBackground {
  if (percent >= 95) {
    return 'error';
  }
  if (percent >= 85) {
    return 'warning';
  }
  return undefined;
}
