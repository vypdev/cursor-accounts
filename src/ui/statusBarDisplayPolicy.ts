import { isEnterpriseUsage } from '../domain';
import type { QuotaUsage } from '../domain';
import { t } from '../l10n';
import type { StatusBarBackground } from './statusBarPresentation';
import {
  buildQuotaText,
  buildQuotaTooltip,
  getProgressPercent,
  getStatusBarBackground,
} from './statusBarPresentation';
import { appendProfileSuffix } from '../utils/statusBarLabel';

export interface StatusBarProfile {
  displayName: string;
  email: string;
}

export interface StatusBarDisplayInput {
  activeProfile: StatusBarProfile | null;
  cachedUsage?: QuotaUsage;
  quotaLoading: boolean;
  quotaError?: string;
  showProfileName: boolean;
  showIncluded: boolean;
  showTotal: boolean;
  showAccountEmail: boolean;
}

export type StatusBarTooltipKind = 'plain' | 'markdown';

export interface StatusBarDisplayItem {
  kind: 'item';
  text: string;
  tooltip: string;
  tooltipKind: StatusBarTooltipKind;
  background: StatusBarBackground;
}

export interface HiddenStatusBarDisplay {
  kind: 'hidden';
}

export type StatusBarDisplay = StatusBarDisplayItem | HiddenStatusBarDisplay;

/**
 * Resolve the status-bar view model without depending on the VS Code API.
 * Rendering and ThemeColor conversion stay in the infrastructure adapter.
 */
export function resolveStatusBarDisplay(
  input: StatusBarDisplayInput
): StatusBarDisplay {
  if (!input.activeProfile) {
    return {
      kind: 'item',
      text: `$(account) ${t('statusBar.selectAccount')}`,
      tooltip: t('statusBar.selectAccountTooltip'),
      tooltipKind: 'plain',
      background: undefined,
    };
  }

  const isEnterprise = input.cachedUsage
    ? isEnterpriseUsage(input.cachedUsage)
    : false;
  const showQuota = isEnterprise
    ? input.showTotal
    : input.showTotal || input.showIncluded;

  if (!showQuota && !input.showProfileName) {
    return { kind: 'hidden' };
  }

  if (!showQuota) {
    return {
      kind: 'item',
      text: `$(account) ${input.activeProfile.displayName}`,
      tooltip: profileTooltip(input.activeProfile),
      tooltipKind: 'plain',
      background: undefined,
    };
  }

  if (input.quotaLoading) {
    return loadingDisplay(
      isEnterprise,
      input.activeProfile.displayName,
      input.showProfileName
    );
  }

  if (input.quotaError) {
    return {
      kind: 'item',
      text: appendProfileSuffix(
        t('statusBar.quotaUnavailable'),
        input.activeProfile.displayName,
        input.showProfileName
      ),
      tooltip: input.quotaError,
      tooltipKind: 'plain',
      background: 'warning',
    };
  }

  if (!input.cachedUsage) {
    return { kind: 'hidden' };
  }

  return {
    kind: 'item',
    text: buildQuotaText(
      input.cachedUsage,
      input.activeProfile.displayName,
      input.showProfileName
    ),
    tooltip: buildQuotaTooltip(input.cachedUsage, input.showAccountEmail),
    tooltipKind: 'markdown',
    background: getStatusBarBackground(getProgressPercent(input.cachedUsage)),
  };
}

function loadingDisplay(
  isEnterprise: boolean,
  profileName: string,
  showProfileName: boolean
): StatusBarDisplayItem {
  const base = isEnterprise
    ? t('statusBar.loadingMonthlyUsage')
    : t('statusBar.loadingUsage');
  const tooltip = isEnterprise
    ? t('statusBar.loadingMonthlyUsageTooltip')
    : t('statusBar.loadingUsageTooltip');
  return {
    kind: 'item',
    text: appendProfileSuffix(base, profileName, showProfileName),
    tooltip,
    tooltipKind: 'plain',
    background: undefined,
  };
}

function profileTooltip(profile: StatusBarProfile): string {
  return t('statusBar.profileActiveTooltip', {
    name: profile.displayName,
    email: profile.email,
  });
}
