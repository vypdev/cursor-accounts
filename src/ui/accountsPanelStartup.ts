import type { Profile } from '../profiles/types';

/**
 * Whether the Accounts panel should open automatically (startup or empty window).
 *
 * Opens when the window has no managed profile (unassigned) or a profile is active
 * but no folder/workspace is open—matching Cursor's welcome / recent-projects flow.
 */
export function shouldAutoOpenAccountsPanel(
  currentProfile: Profile | null,
  hasActiveWorkspace: boolean
): boolean {
  return currentProfile === null || !hasActiveWorkspace;
}
