import type { ProfileQuota, WorkspaceInfo } from '../types';
import { getPersonalIncludedOverageCents } from '../types';

export type ProfileCardTranslator = (
  key: string,
  args?: Record<string, string | number | undefined>
) => string;

export const MAX_DISPLAY_WORKSPACES = 10;

export function formatResetDate(
  isoString: string,
  t: ProfileCardTranslator
): string {
  if (!isoString) {
    return t('profileCard.unknownDate');
  }

  const numeric = Number(isoString);
  const date = Number.isFinite(numeric)
    ? new Date(numeric)
    : new Date(isoString);

  if (Number.isNaN(date.getTime())) {
    return t('profileCard.unknownDate');
  }

  const now = new Date();
  const days = Math.ceil(
    (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (days <= 0) {
    return t('profileCard.today');
  }
  if (days === 1) {
    return t('profileCard.tomorrow');
  }
  return t('profileCard.daysUntilReset', { days });
}

export function isAuthError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes('authentication') ||
    lower.includes('token') ||
    lower.includes('sign in') ||
    lower.includes('expired')
  );
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    const only = parts[0] ?? '?';
    return only.charAt(0).toUpperCase();
  }
  const first = parts[0] ?? '?';
  const last = parts[parts.length - 1] ?? first;
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export function formatDollarAmount(cents: number): string {
  if (!Number.isFinite(cents)) {
    return '0.00';
  }
  return (cents / 100).toFixed(2);
}

export function formatRemainingLabel(
  quota: NonNullable<ProfileQuota['quota']>,
  t: ProfileCardTranslator
): string {
  const remaining = formatDollarAmount(quota.remaining);
  const includedOverage = getPersonalIncludedOverageCents(quota);
  if (includedOverage > 0) {
    return t('profileCard.remainingWithIncluded', {
      amount: remaining,
      included: formatDollarAmount(includedOverage),
    });
  }
  return t('profileCard.remaining', { amount: remaining });
}

export function getRepositoryName(
  repoPath: string,
  workspaces?: WorkspaceInfo[]
): string {
  const workspace = workspaces?.find((item) => item.path === repoPath);
  if (workspace) {
    return workspace.name;
  }
  const normalized = repoPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? repoPath;
}
