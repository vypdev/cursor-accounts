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
    return selectAccountDisplay();
  }

  return resolveActiveProfileDisplay(input, input.activeProfile);
}

function resolveActiveProfileDisplay(
  input: StatusBarDisplayInput,
  profile: StatusBarProfile
): StatusBarDisplay {
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
    return profileOnlyDisplay(profile);
  }

  if (input.quotaLoading) {
    return loadingDisplay(
      isEnterprise,
      profile.displayName,
      input.showProfileName
    );
  }

  if (input.quotaError) {
    return errorDisplay(
      input.quotaError,
      profile.displayName,
      input.showProfileName
    );
  }

  if (!input.cachedUsage) {
    return { kind: 'hidden' };
  }

  return quotaDisplay(input.cachedUsage, profile.displayName, input);
}

function selectAccountDisplay(): StatusBarDisplayItem {
  return {
    kind: 'item',
    text: `$(account) ${t('statusBar.selectAccount')}`,
    tooltip: t('statusBar.selectAccountTooltip'),
    tooltipKind: 'plain',
    background: undefined,
  };
}

function profileOnlyDisplay(profile: StatusBarProfile): StatusBarDisplayItem {
  return {
    kind: 'item',
    text: `$(account) ${profile.displayName}`,
    tooltip: profileTooltip(profile),
    tooltipKind: 'plain',
    background: undefined,
  };
}

function errorDisplay(
  error: string,
  profileName: string,
  showProfileName: boolean
): StatusBarDisplayItem {
  return {
    kind: 'item',
    text: appendProfileSuffix(
      t('statusBar.quotaUnavailable'),
      profileName,
      showProfileName
    ),
    tooltip: error,
    tooltipKind: 'plain',
    background: 'warning',
  };
}

function quotaDisplay(
  usage: QuotaUsage,
  profileName: string,
  input: StatusBarDisplayInput
): StatusBarDisplayItem {
  return {
    kind: 'item',
    text: buildQuotaText(usage, profileName, input.showProfileName),
    tooltip: buildQuotaTooltip(usage, input.showAccountEmail),
    tooltipKind: 'markdown',
    background: getStatusBarBackground(getProgressPercent(usage)),
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
