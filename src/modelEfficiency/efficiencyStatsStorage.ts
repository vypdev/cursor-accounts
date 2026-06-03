import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  EfficiencyStats,
  EfficiencyStatsMap,
} from '@cursor-accounts/types';
import type { Profile } from '../profiles/types';
import * as extensionLog from '../logging/extensionLog';
import {
  EfficiencyDatabase,
  getEfficiencyDbPath,
} from '../persistence/efficiencyDatabase';
import type { PromptEventRecord } from '../persistence/types';

/** @deprecated Legacy JSON filename; DB replaces this storage. */
export const EFFICIENCY_STATS_FILENAME = 'cursor-accounts-efficiency.json';

export type StatsUpdatedListener = (profileId: string) => void;

export class EfficiencyStatsStorage {
  private readonly statsCache = new Map<string, EfficiencyStats>();
  private readonly databases = new Map<string, EfficiencyDatabase>();
  private statsUpdatedListener?: StatsUpdatedListener;

  constructor(private readonly extensionPath: string) {}

  setStatsUpdatedListener(listener: StatsUpdatedListener | undefined): void {
    this.statsUpdatedListener = listener;
  }

  private getDbPath(userDataDir: string): string {
    return getEfficiencyDbPath(userDataDir);
  }

  private async getDatabase(userDataDir: string): Promise<EfficiencyDatabase> {
    const existing = this.databases.get(userDataDir);
    if (existing) {
      return existing;
    }

    const db = new EfficiencyDatabase(
      this.getDbPath(userDataDir),
      this.extensionPath
    );
    await db.initialize();
    this.databases.set(userDataDir, db);
    return db;
  }

  async loadStats(profile: Profile): Promise<EfficiencyStats | undefined> {
    if (!profile.efficiencyAnalysisEnabled) {
      return undefined;
    }

    try {
      const db = await this.getDatabase(profile.userDataDir);
      const stats = await db.getAggregatedStats(profile.id);
      if (stats.totalPrompts === 0) {
        return undefined;
      }
      this.statsCache.set(profile.id, stats);
      return stats;
    } catch (error) {
      extensionLog.error(
        `[EfficiencyStatsStorage] Failed to load stats for ${profile.id}: ${extensionLog.formatError(error)}`
      );
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

  async recordEvent(
    profile: Profile,
    event: PromptEventRecord
  ): Promise<void> {
    if (!profile.efficiencyAnalysisEnabled) {
      return;
    }

    try {
      const db = await this.getDatabase(profile.userDataDir);
      await db.insertEvent(event);
      const stats = await db.getAggregatedStats(profile.id);
      this.statsCache.set(profile.id, stats);
      this.statsUpdatedListener?.(profile.id);
    } catch (error) {
      extensionLog.error(
        `[EfficiencyStatsStorage] Failed to save event for ${profile.id}: ${extensionLog.formatError(error)}`
      );
    }
  }

  async recordAnalysis(
    profile: Profile,
    efficiencyScore: number,
    workspaceRoot?: string,
    gitBranch?: string
  ): Promise<void> {
    const event: PromptEventRecord = {
      profileId: profile.id,
      timestamp: Date.now(),
      promptText: '',
      modelUsed: 'unknown',
      efficiencyScore,
      severity: 'medium',
      confidence: 0,
      taskType: 'unknown',
      repositoryPath: workspaceRoot,
      branchName: gitBranch,
      conversationId: '',
      scoredAt: Date.now(),
      requiredTier: 0,
      actualTier: 0,
      recommendedModel: '',
      opinion: '',
    };

    await this.recordEvent(profile, event);
  }

  async deleteStats(profile: Profile): Promise<void> {
    const dbPath = this.getDbPath(profile.userDataDir);
    this.databases.delete(profile.userDataDir);
    this.statsCache.delete(profile.id);

    try {
      await fs.unlink(dbPath);
    } catch {
      // File may not exist.
    }
    await fs.unlink(`${dbPath}-wal`).catch(() => {});
    await fs.unlink(`${dbPath}-shm`).catch(() => {});

    const legacyJson = path.join(
      profile.userDataDir,
      'User',
      'globalStorage',
      EFFICIENCY_STATS_FILENAME
    );
    await fs.unlink(legacyJson).catch(() => {});
  }
}
