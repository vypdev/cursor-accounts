import type { PromptMetadata, ScoringResult } from './types';

/** Port for storing the per-profile API key used by efficiency analysis. */
export interface EfficiencyApiKeyStore {
  createApiKey(profileId: string, accessToken: string): Promise<string>;
  getApiKey(profileId: string): Promise<string | undefined>;
  deleteApiKey(profileId: string): Promise<void>;
}

/** Output operations required by the model-efficiency application workflow. */
export interface EfficiencyOutputPresenter {
  dispose(): void;
  show(): void;
  appendStatus(message: string): void;
  presentError(message: string, metadata?: PromptMetadata): void;
  present(result: ScoringResult, metadata: PromptMetadata): void;
}

/** Minimal analyzer boundary required by the Composer state poller. */
export interface EfficiencyAnalyzerPort {
  enqueue(metadata: PromptMetadata): void;
}

/** Lifecycle boundary used by the efficiency application service. */
export interface EfficiencyPoller {
  start(): void;
  stop(): void;
  resetState(): Promise<void>;
}
