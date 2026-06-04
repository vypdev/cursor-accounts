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

export interface ConversationRecord {
  conversationId: string;
  profileId: string;
  createdAt: number;
  lastActivity: number;
  messageCount?: number;
}

export interface AgentRecord {
  requestId: string;
  conversationId: string;
  conversationGroupId?: string;
  parentRequestId?: string;
  subagentRequestId?: string;
  modelName?: string;
  startedAt: number;
  endedAt?: number;
  isEof: boolean;
  profileId: string;
}

export type AgentTokenType = 'delta' | 'turn_ended' | 'token_details';

export interface TokenSnapshotRecord {
  id: number;
  requestId: string;
  tokenType: AgentTokenType;
  streamingTokens?: number;
  outputTokens?: number;
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  usageUuid?: string;
  recordedAt: number;
  modelName?: string;
}

export interface AgentTreeNode {
  requestId: string;
  parentRequestId?: string;
  modelName?: string;
  startedAt: number;
  endedAt?: number;
  totalTokens: number;
  children: AgentTreeNode[];
}

export interface ConversationTokenTotals {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalTokens: number;
  agentCount: number;
  models: string[];
  startedAt: number;
  endedAt: number;
}
