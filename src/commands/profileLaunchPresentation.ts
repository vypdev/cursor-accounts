import type { Profile } from '@cursor-accounts/types';

/** Localized text required to render a profile launch quick-pick item. */
export interface ProfileLaunchLabels {
  lastLaunched: (date: string) => string;
  lastLaunchedNever: string;
}

/** UI-neutral quick-pick item consumed by the VS Code command adapter. */
export interface ProfileLaunchQuickPickItem {
  label: string;
  description: string;
  detail: string;
  profile: Profile;
}

/** Builds launch choices without coupling profile presentation to VS Code. */
export function buildProfileLaunchQuickPickItems(
  profiles: readonly Profile[],
  labels: ProfileLaunchLabels,
  formatDate: (date: string) => string
): ProfileLaunchQuickPickItem[] {
  return profiles.map((profile) => ({
    label: profile.displayName,
    description: profile.email,
    detail: labels.lastLaunched(
      profile.lastLaunched
        ? formatDate(profile.lastLaunched)
        : labels.lastLaunchedNever
    ),
    profile,
  }));
}
