import type {
  EfficiencySeverity,
  EfficiencyTaskType,
} from '../modelEfficiency/types';

export const EFFICIENCY_DB_FILENAME = 'cursor-accounts-efficiency.db';

export const EXPECTED_SCHEMA_TABLES = [
  'prompt_events',
  'database_metadata',
  'conversations',
  'agents',
  'agent_tokens',
  'agent_tokens_delta',
  'agent_tokens_delta_events',
  'agent_turn_ended',
] as const;

export interface PromptEventRecord {
  profileId: string;
  timestamp: number;
  promptText: string;
  modelUsed: string;
  efficiencyScore: number;
  severity: EfficiencySeverity;
  confidence: number;
  taskType: EfficiencyTaskType;
  repositoryPath?: string;
  branchName?: string;
  conversationId: string;
  scoredAt: number;
  requiredTier: number;
  actualTier: number;
  recommendedModel: string;
  opinion: string;
  quotaPercentUsed?: number;
  quotaLimit?: number;
  quotaRemaining?: number;
  quotaCycleStart?: number;
  quotaCycleEnd?: number;
  quotaIsEnterprise?: boolean;
}

export interface MigrationDefinition {
  version: number;
  name: string;
  filename: string;
  sql: string;
}

export interface MigrationResult {
  success: boolean;
  fromVersion: number;
  toVersion: number;
  migrationsApplied: string[];
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  expectedTables: readonly string[];
  missingTables: string[];
  error?: string;
}

export interface QuotaEfficiencyAggregate {
  avgEfficiency: number;
  count: number;
}

export interface QuotaBucketAggregate {
  quotaBucket: number;
  avgEfficiency: number;
  count: number;
}

export type {
  AgentRecord,
  AgentTokenType,
  AgentTreeNode,
  ConversationDeltaTotals,
  ConversationRecord,
  ConversationTokenTotals,
  TokenDeltaMinuteRecord,
  TokenSnapshotRecord,
  TurnEndedRecord,
} from '../application/types/agentPersistence';
