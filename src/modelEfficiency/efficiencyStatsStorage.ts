import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  EfficiencyStats,
  EfficiencyStatsMap,
} from '@cursor-accounts/types';
import {
  createEmptyEfficiencyStats,
  EFFICIENCY_SCORE_THRESHOLD,
} from '@cursor-accounts/types';
import type { Profile } from '../profiles/types';
import * as extensionLog from '../logging/extensionLog';

export const EFFICIENCY_STATS_FILENAME = 'cursor-accounts-efficiency.json';

export type StatsUpdatedListener = (profileId: string) => void;

export class EfficiencyStatsStorage {
  private readonly statsCache = new Map<string, EfficiencyStats>();
  private statsUpdatedListener?: StatsUpdatedListener;

  setStatsUpdatedListener(listener: StatsUpdatedListener | undefined): void {
    this.statsUpdatedListener = listener;
  }

  private getStatsPath(userDataDir: string): string {
    return path.join(
      userDataDir,
      'User',
      'globalStorage',
      EFFICIENCY_STATS_FILENAME
    );
  }

  private normalizeStats(raw: EfficiencyStats, profileId: string): EfficiencyStats {
    return {
      profileId: raw.profileId ?? profileId,
      totalPrompts: raw.totalPrompts ?? 0,
      efficientPrompts: raw.efficientPrompts ?? 0,
      inefficientPrompts: raw.inefficientPrompts ?? 0,
      lastUpdated: raw.lastUpdated ?? new Date().toISOString(),
      byRepository: raw.byRepository ?? {},
    };
  }

  async loadStats(profile: Profile): Promise<EfficiencyStats | undefined> {
    const statsPath = this.getStatsPath(profile.userDataDir);
    try {
      const content = await fs.readFile(statsPath, 'utf-8');
      const parsed = JSON.parse(content) as EfficiencyStats;
      const stats = this.normalizeStats(parsed, profile.id);
      this.statsCache.set(profile.id, stats);
      return stats;
    } catch {
      return undefined;
    }
  }

  async loadAllStats(profiles: Profile[]): Promise<Map<string, EfficiencyStats>> {
    await Promise.all(
      profiles
        .filter((profile) => profile.efficiencyAnalysisEnabled)
        .map((profile) => this.loadStats(profile))
    );
    return new Map(this.statsCache);
  }

  getStats(profileId: string): EfficiencyStats | undefined {
    return this.statsCache.get(profileId);
  }

  getAllStats(): EfficiencyStatsMap {
    return Object.fromEntries(this.statsCache);
  }

  async saveStats(profile: Profile, stats: EfficiencyStats): Promise<void> {
    const statsPath = this.getStatsPath(profile.userDataDir);
    const dir = path.dirname(statsPath);
    await fs.mkdir(dir, { recursive: true });

    const tempPath = `${statsPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(stats, null, 2), 'utf-8');
    await fs.rename(tempPath, statsPath);

    this.statsCache.set(profile.id, stats);
  }

  async recordAnalysis(
    profile: Profile,
    efficiencyScore: number,
    workspaceRoot?: string,
    gitBranch?: string
  ): Promise<void> {
    if (!profile.efficiencyAnalysisEnabled) {
      return;
    }

    const existing = this.statsCache.get(profile.id);
    const stats = existing ?? createEmptyEfficiencyStats(profile.id);
    const isEfficient = efficiencyScore >= EFFICIENCY_SCORE_THRESHOLD;
    const now = new Date().toISOString();

    stats.totalPrompts += 1;
    if (isEfficient) {
      stats.efficientPrompts += 1;
    } else {
      stats.inefficientPrompts += 1;
    }
    stats.lastUpdated = now;

    if (workspaceRoot) {
      const repoStats = stats.byRepository[workspaceRoot] ?? {
        repositoryPath: workspaceRoot,
        totalPrompts: 0,
        efficientPrompts: 0,
        inefficientPrompts: 0,
        lastAnalyzed: now,
        byBranch: {},
      };

      repoStats.totalPrompts += 1;
      if (isEfficient) {
        repoStats.efficientPrompts += 1;
      } else {
        repoStats.inefficientPrompts += 1;
      }
      repoStats.lastAnalyzed = now;

      if (gitBranch) {
        const branchStats = repoStats.byBranch[gitBranch] ?? {
          branchName: gitBranch,
          totalPrompts: 0,
          efficientPrompts: 0,
          inefficientPrompts: 0,
          lastAnalyzed: now,
        };

        branchStats.totalPrompts += 1;
        if (isEfficient) {
          branchStats.efficientPrompts += 1;
        } else {
          branchStats.inefficientPrompts += 1;
        }
        branchStats.lastAnalyzed = now;

        repoStats.byBranch[gitBranch] = branchStats;
      }

      stats.byRepository[workspaceRoot] = repoStats;
    }

    try {
      await this.saveStats(profile, stats);
      this.statsUpdatedListener?.(profile.id);
    } catch (error) {
      extensionLog.error(
        `[EfficiencyStatsStorage] Failed to save stats for ${profile.id}: ${extensionLog.formatError(error)}`
      );
    }
  }

  async deleteStats(profile: Profile): Promise<void> {
    const statsPath = this.getStatsPath(profile.userDataDir);
    try {
      await fs.unlink(statsPath);
    } catch {
      // File may not exist.
    }
    this.statsCache.delete(profile.id);
  }
}
