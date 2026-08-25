import type { ProfileDetector } from '../profiles/profileDetector';
import type { IProfileWriter } from '../domain/ports/IProfileWriter';
import * as extensionLog from '../logging/extensionLog';
import type { MultiProfileQuotaService } from '../services/multiProfileQuotaService';
import type { ApiKeyManager } from './apiKeyManager';
import type { EfficiencyStatsStorage } from './efficiencyStatsStorage';
import type { OutputPresenter } from './outputPresenter';
import type { SdkClassifier } from './sdkClassifier';
import type { PromptMetadata } from './types';
import { EfficiencyAnalysisQueue } from './efficiencyAnalysisQueue';
import { EfficiencyAnalysisWorkflow } from './efficiencyAnalysisWorkflow';

export class EfficiencyAnalyzer {
  private readonly workflow: EfficiencyAnalysisWorkflow;
  private readonly queue: EfficiencyAnalysisQueue;

  constructor(
    profileWriter: IProfileWriter,
    profileDetector: ProfileDetector,
    apiKeyManager: ApiKeyManager,
    sdkClassifier: SdkClassifier,
    private readonly outputPresenter: OutputPresenter,
    statsStorage: EfficiencyStatsStorage,
    multiProfileQuotaService: MultiProfileQuotaService
  ) {
    this.workflow = new EfficiencyAnalysisWorkflow(
      profileWriter,
      profileDetector,
      apiKeyManager,
      sdkClassifier,
      outputPresenter,
      statsStorage,
      multiProfileQuotaService
    );
    this.queue = new EfficiencyAnalysisQueue(
      (metadata) => this.workflow.run(metadata),
      (error, metadata) => {
        const message =
          error instanceof Error ? error.message : 'Unknown analysis error';
        extensionLog.error(`[EfficiencyAnalyzer] ${message}`);
        this.outputPresenter.presentError(message, metadata);
      }
    );
  }

  enqueue(metadata: PromptMetadata): void {
    this.queue.enqueue(metadata);
  }

  async analyzePrompt(metadata: PromptMetadata): Promise<void> {
    return this.workflow.run(metadata);
  }
}
