import type { EfficiencyStatsMap, EfficiencyStats } from '@cursor-accounts/types';
import type { Profile } from '../../profiles/types';
import type {
  EfficiencyStatsStorage,
  StatsUpdatedListener,
} from '../../modelEfficiency/efficiencyStatsStorage';

export function createMockEfficiencyStatsStorage(): EfficiencyStatsStorage {
  let listener: StatsUpdatedListener | undefined;

  return {
    setStatsUpdatedListener: (next: StatsUpdatedListener | undefined) => {
      listener = next;
    },
    loadStats: async () => undefined,
    loadAllStats: async () => new Map(),
    getStats: () => undefined,
    getAllStats: (): EfficiencyStatsMap => ({}),
    saveStats: async (_profile: Profile, stats: EfficiencyStats) => {
      void stats;
    },
    recordAnalysis: async () => {
      listener?.('profile-a');
    },
    recordEvent: async () => {
      listener?.('profile-a');
    },
    deleteStats: async () => {},
  } as unknown as EfficiencyStatsStorage;
}
