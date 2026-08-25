import { t } from '../l10n';
import * as extensionLog from '../logging/extensionLog';
import type { IProfileWriter } from '../domain/ports/IProfileWriter';
import type { ProfileDetector } from '../profiles/profileDetector';
import type { Profile } from '../profiles/types';
import type { MultiProfileQuotaService } from '../services/multiProfileQuotaService';
import type { PromptEventRecord } from '../persistence/types';
import type { ApiKeyManager } from './apiKeyManager';
import type { EfficiencyStatsStorage } from './efficiencyStatsStorage';
import { buildQuotaFieldsFromProfileQuota } from './quotaSnapshot';
import type { OutputPresenter } from './outputPresenter';
import type { SdkClassifier } from './sdkClassifier';
import type { PromptMetadata } from './types';

/** Runs one model-efficiency analysis after the queue has admitted it. */
export class EfficiencyAnalysisWorkflow {
  constructor(
    private readonly profileWriter: IProfileWriter,
    private readonly profileDetector: ProfileDetector,
    private readonly apiKeyManager: ApiKeyManager,
    private readonly sdkClassifier: SdkClassifier,
    private readonly outputPresenter: OutputPresenter,
    private readonly statsStorage: EfficiencyStatsStorage,
    private readonly multiProfileQuotaService: MultiProfileQuotaService
  ) {}

  async run(metadata: PromptMetadata): Promise<void> {
    const profile = await this.resolveProfileForAnalysis(metadata);
    if (!profile) {
      extensionLog.debug(
        '[EfficiencyAnalysisWorkflow] Skip (no matching profile window or efficiency disabled)'
      );
      return;
    }

    extensionLog.info(
      `[EfficiencyAnalysisWorkflow] Analyzing prompt for ${profile.email} (model: ${metadata.model})`
    );
    this.outputPresenter.appendStatus(
      t('efficiency.analyzing', { model: metadata.model, email: profile.email })
    );

    const apiKey = await this.apiKeyManager.getApiKey(profile.id);
    if (!apiKey) {
      extensionLog.warn(
        `[EfficiencyAnalysisWorkflow] No API key for profile ${profile.id}; skip analysis`
      );
      this.outputPresenter.presentError(t('efficiency.noApiKey'), metadata);
      return;
    }

    const result = await this.sdkClassifier.classify(metadata, apiKey);
    this.outputPresenter.present(result, metadata);

    const cachedQuota = this.multiProfileQuotaService.getCachedQuota(profile.id);
    const quotaFields = buildQuotaFieldsFromProfileQuota(cachedQuota);
    const eventRecord: PromptEventRecord = {
      profileId: profile.id,
      timestamp: metadata.timestamp,
      promptText: metadata.prompt,
      modelUsed: metadata.model,
      efficiencyScore: result.efficiencyScore,
      severity: result.severity,
      confidence: result.confidence,
      taskType: result.taskType,
      repositoryPath: metadata.workspaceRoots[0],
      branchName: metadata.gitBranch,
      conversationId: metadata.conversationId,
      scoredAt: result.scoredAt,
      requiredTier: result.requiredTier,
      actualTier: result.actualTier,
      recommendedModel: result.recommendedModel,
      opinion: result.opinion,
      ...quotaFields,
    };

    void this.statsStorage.recordEvent(profile, eventRecord);
    await this.profileWriter.updateProfile(profile.id, {
      metadata: {
        ...profile.metadata,
        efficiencyLastAnalysisAt: new Date().toISOString(),
      },
    });
  }

  private async resolveProfileForAnalysis(
    metadata: PromptMetadata
  ): Promise<Profile | undefined> {
    const current = await this.profileDetector.detectCurrentProfile();
    if (!current?.efficiencyAnalysisEnabled) {
      return undefined;
    }

    if (metadata.userEmail?.trim()) {
      const byEmail = await this.profileWriter.findProfileByEmail(
        metadata.userEmail
      );
      if (byEmail?.id === current.id && byEmail.efficiencyAnalysisEnabled) {
        return byEmail;
      }
      if (
        byEmail?.efficiencyAnalysisEnabled &&
        byEmail.email.toLowerCase() !== current.email.toLowerCase()
      ) {
        return undefined;
      }
    }

    return current;
  }
}
