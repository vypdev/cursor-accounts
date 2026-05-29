import { ProfileDetector } from '../profiles/profileDetector';
import { ProfileManager } from '../profiles/profileManager';
import { Profile } from '../profiles/types';
import * as extensionLog from '../logging/extensionLog';
import { t } from '../l10n';
import { ApiKeyManager } from './apiKeyManager';
import { OutputPresenter } from './outputPresenter';
import { SdkClassifier } from './sdkClassifier';
import { PromptMetadata } from './types';

export class EfficiencyAnalyzer {
  private readonly processing = new Set<string>();
  private readonly pending: PromptMetadata[] = [];
  private inFlight = 0;
  private readonly maxConcurrent = 2;

  constructor(
    private readonly profileManager: ProfileManager,
    private readonly profileDetector: ProfileDetector,
    private readonly apiKeyManager: ApiKeyManager,
    private readonly sdkClassifier: SdkClassifier,
    private readonly outputPresenter: OutputPresenter
  ) {}

  enqueue(metadata: PromptMetadata): void {
    const dedupeKey = `${metadata.conversationId}:${metadata.timestamp}:${metadata.prompt.slice(0, 64)}`;
    if (this.processing.has(dedupeKey)) {
      return;
    }

    if (this.inFlight >= this.maxConcurrent) {
      this.pending.push(metadata);
      extensionLog.debug(
        `[EfficiencyAnalyzer] Queued analysis (${this.inFlight} in flight)`
      );
      return;
    }

    this.processing.add(dedupeKey);
    this.inFlight += 1;

    void this.analyzePrompt(metadata)
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : 'Unknown analysis error';
        extensionLog.error(`[EfficiencyAnalyzer] ${message}`);
        this.outputPresenter.presentError(message, metadata);
      })
      .finally(() => {
        this.processing.delete(dedupeKey);
        this.inFlight -= 1;
        void this.drainPending();
      });
  }

  private drainPending(): void {
    while (this.inFlight < this.maxConcurrent && this.pending.length > 0) {
      const next = this.pending.shift();
      if (next) {
        this.enqueue(next);
      }
    }
  }

  async analyzePrompt(metadata: PromptMetadata): Promise<void> {
    const profile = await this.resolveProfileForAnalysis(metadata);
    if (!profile) {
      extensionLog.debug(
        '[EfficiencyAnalyzer] Skip (no matching profile window or efficiency disabled)'
      );
      return;
    }

    extensionLog.info(
      `[EfficiencyAnalyzer] Analyzing prompt for ${profile.email} (model: ${metadata.model})`
    );
    this.outputPresenter.appendStatus(
      t('efficiency.analyzing', { model: metadata.model, email: profile.email })
    );

    const apiKey = await this.apiKeyManager.getApiKey(profile.id);
    if (!apiKey) {
      extensionLog.warn(
        `[EfficiencyAnalyzer] No API key for profile ${profile.id}; skip analysis`
      );
      this.outputPresenter.presentError(
        t('efficiency.noApiKey'),
        metadata
      );
      return;
    }

    const result = await this.sdkClassifier.classify(metadata, apiKey);
    this.outputPresenter.present(result, metadata);

    await this.profileManager.updateProfile(profile.id, {
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
      const byEmail = await this.profileManager.findProfileByEmail(
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
