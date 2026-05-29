export const EFFICIENCY_API_KEY_NAME = 'Cursor Accounts - API Key';

export type EfficiencySeverity = 'low' | 'medium' | 'high';

export type EfficiencyTaskType =
  | 'factual_simple'
  | 'explanation'
  | 'debugging'
  | 'refactor'
  | 'codegen_scoped'
  | 'architecture'
  | 'review'
  | 'unknown';

export interface EfficiencyState {
  profileId: string;
  enabled: boolean;
  apiKeyCreatedAt?: string;
  lastAnalysisAt?: number;
}

export interface PromptAttachment {
  type: string;
  file_path: string;
}

export interface PromptMetadata {
  timestamp: number;
  prompt: string;
  /** Resolved model slug (legacySlug when catalog match succeeds). */
  model: string;
  modelResolved?: boolean;
  attachments: PromptAttachment[];
  conversationId: string;
  workspaceRoots: string[];
  userEmail?: string;
}

export interface ModelParameter {
  id: string;
  value: string;
}

export interface SelectedModel {
  modelId: string;
  parameters?: ModelParameter[];
}

export interface ComposerModelConfig {
  modelName?: string;
  maxMode?: boolean;
  selectedModels?: SelectedModel[];
}

export interface ResolvedModel {
  slug: string;
  baseModelId: string;
  maxMode: boolean;
  parameters: ModelParameter[];
  resolved: boolean;
  displayName?: string;
}

export interface ComposerHeaderEntry {
  composerId?: string;
  lastUpdatedAt?: number;
  createdAt?: number;
  unifiedMode?: string;
  trackedGitRepos?: Array<{ repoPath?: string }>;
}

export interface ComposerHeadersPayload {
  allComposers?: ComposerHeaderEntry[];
}

export interface ConversationBubbleHeader {
  bubbleId: string;
  type: number;
}

export interface ComposerDataRow {
  composerId?: string;
  modelConfig?: ComposerModelConfig;
  fullConversationHeadersOnly?: ConversationBubbleHeader[];
  text?: string;
  richText?: string;
}

export interface BubbleRow {
  type?: number;
  text?: string;
  richText?: string;
  createdAt?: string;
  bubbleId?: string;
}

export interface DbPollerState {
  seenBubbleIds: Record<string, string[]>;
  lastUpdatedAtByComposer: Record<string, number>;
  enabledAt?: string;
}

export const DB_POLLER_STATE_KEY = 'efficiency.dbPollerState';
export const SEEN_BUBBLES_CAP_PER_COMPOSER = 200;

export interface ScoringResult {
  promptExcerpt: string;
  selectedModel: string;
  taskType: EfficiencyTaskType | string;
  requiredTier: number;
  actualTier: number;
  efficiencyScore: number;
  severity: EfficiencySeverity;
  opinion: string;
  recommendedModel: string;
  confidence: number;
  scoredAt: number;
}

export interface SdkClassificationPayload {
  taskType?: string;
  requiredTier?: number;
  actualTier?: number;
  efficiencyScore?: number;
  severity?: string;
  opinion?: string;
  recommendedModel?: string;
  confidence?: number;
}
