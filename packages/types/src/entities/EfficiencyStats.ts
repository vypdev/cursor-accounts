/** Per-branch efficiency counters within a repository. */
export interface BranchEfficiencyStats {
  branchName: string;
  totalPrompts: number;
  efficientPrompts: number;
  inefficientPrompts: number;
  lastAnalyzed: string;
}

/** Per-repository efficiency counters with optional branch breakdown. */
export interface RepositoryEfficiencyStats {
  repositoryPath: string;
  totalPrompts: number;
  efficientPrompts: number;
  inefficientPrompts: number;
  lastAnalyzed: string;
  byBranch: Record<string, BranchEfficiencyStats>;
}

/** Account-level efficiency stats with repository and branch hierarchy. */
export interface EfficiencyStats {
  profileId: string;
  totalPrompts: number;
  efficientPrompts: number;
  inefficientPrompts: number;
  lastUpdated: string;
  byRepository: Record<string, RepositoryEfficiencyStats>;
}

export type EfficiencyStatsMap = Record<string, EfficiencyStats>;

/** Score at or above this value counts as efficient (matches output presenter). */
export const EFFICIENCY_SCORE_THRESHOLD = 0.7;

export interface EfficiencyCountStats {
  totalPrompts: number;
  efficientPrompts: number;
}

export function getEfficiencyPercentage(
  stats: EfficiencyCountStats | undefined
): number {
  if (!stats || stats.totalPrompts === 0) {
    return 0;
  }
  return Math.round((stats.efficientPrompts / stats.totalPrompts) * 100);
}

export function getEfficiencyFillStatus(
  stats: EfficiencyCountStats | undefined
): 'ok' | 'warning' | 'critical' {
  const percent = getEfficiencyPercentage(stats);
  if (percent >= 70) {
    return 'ok';
  }
  if (percent >= 50) {
    return 'warning';
  }
  return 'critical';
}

export function createEmptyEfficiencyStats(profileId: string): EfficiencyStats {
  return {
    profileId,
    totalPrompts: 0,
    efficientPrompts: 0,
    inefficientPrompts: 0,
    lastUpdated: new Date().toISOString(),
    byRepository: {},
  };
}
