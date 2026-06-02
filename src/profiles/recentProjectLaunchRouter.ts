import { pathsEqual } from '../utils/pathUtils';

export type RecentProjectLaunchAction =
  | { kind: 'noop' }
  | { kind: 'openInCurrentWindow'; projectPath: string }
  | { kind: 'spawnProfileWindow'; profileId: string; projectPath: string };

function isProjectOpenInPaths(
  projectPath: string,
  openWorkspacePaths: string[]
): boolean {
  return openWorkspacePaths.some((p) => pathsEqual(p, projectPath));
}

/**
 * Resolves how to open a recent project from the Accounts panel.
 *
 * Same account as the active window → reuse current window (native recent-projects).
 * Different account or undetected profile → spawn a separate Cursor instance.
 */
export function resolveRecentProjectLaunch(input: {
  targetProfileId: string;
  projectPath: string;
  currentProfileId: string | null;
  openWorkspacePaths: string[];
}): RecentProjectLaunchAction {
  const { targetProfileId, projectPath, currentProfileId, openWorkspacePaths } =
    input;

  if (isProjectOpenInPaths(projectPath, openWorkspacePaths)) {
    return { kind: 'noop' };
  }

  if (currentProfileId === targetProfileId) {
    return { kind: 'openInCurrentWindow', projectPath };
  }

  return {
    kind: 'spawnProfileWindow',
    profileId: targetProfileId,
    projectPath,
  };
}
