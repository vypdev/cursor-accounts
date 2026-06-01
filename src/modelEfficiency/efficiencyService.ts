import * as vscode from 'vscode';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import * as extensionLog from '../logging/extensionLog';
import { t } from '../l10n';
import type { Profile } from '../profiles/types';
import type { ProfileManager } from '../profiles/profileManager';
import { ApiKeyManager, ApiKeyManagerError } from './apiKeyManager';
import { ComposerDbPoller } from './composerDbPoller';
import { EfficiencyAnalyzer } from './efficiencyAnalyzer';
import { OutputPresenter } from './outputPresenter';
import { CursorSdkClassifier } from './sdkClassifier';
import type { ProfileDetector } from '../profiles/profileDetector';

export function getEfficiencyWrongWindowMessage(): string {
  return t('errors.efficiencyWrongWindow');
}

export class EfficiencyService {
  private readonly apiKeyManager: ApiKeyManager;
  private readonly outputPresenter: OutputPresenter;
  private readonly sdkClassifier = new CursorSdkClassifier();
  private readonly analyzer: EfficiencyAnalyzer;
  private poller?: ComposerDbPoller;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileManager: ProfileManager,
    private readonly profileDetector: ProfileDetector,
    private readonly authReader: IProfileAuthReader
  ) {
    this.apiKeyManager = new ApiKeyManager(context);
    this.outputPresenter = new OutputPresenter();
    this.analyzer = new EfficiencyAnalyzer(
      profileManager,
      profileDetector,
      this.apiKeyManager,
      this.sdkClassifier,
      this.outputPresenter
    );
  }

  getOutputPresenter(): OutputPresenter {
    return this.outputPresenter;
  }

  async initialize(): Promise<void> {
    const profiles = await this.profileManager.getProfiles();
    if (profiles.some((p) => p.efficiencyAnalysisEnabled)) {
      this.startPoller();
    }
  }

  dispose(): void {
    this.poller?.stop();
    this.poller = undefined;
    this.outputPresenter.dispose();
  }

  private startPoller(): void {
    if (this.poller) {
      return;
    }

    this.poller = new ComposerDbPoller(
      this.context,
      this.profileDetector,
      this.context.extensionPath,
      this.analyzer
    );
    this.poller.start();
  }

  private async syncPollerWithProfiles(): Promise<void> {
    const profiles = await this.profileManager.getProfiles();
    const anyEnabled = profiles.some((p) => p.efficiencyAnalysisEnabled);

    if (anyEnabled) {
      this.startPoller();
    } else {
      this.poller?.stop();
      this.poller = undefined;
    }
  }

  async setEfficiencyEnabled(
    profileId: string,
    enabled: boolean
  ): Promise<{ profile: Profile; message: string }> {
    const current = await this.profileDetector.detectCurrentProfile();
    if (!current || current.id !== profileId) {
      throw new Error(getEfficiencyWrongWindowMessage());
    }

    const profile = await this.profileManager.getProfile(profileId);
    if (!profile) {
      throw new Error(t('errors.profileNotFound'));
    }

    if (enabled) {
      const confirmLabel = t('efficiency.consent.confirm');
      const cancelLabel = t('efficiency.consent.cancel');
      const consent = await vscode.window.showInformationMessage(
        t('efficiency.consent.message'),
        { modal: true },
        { title: confirmLabel },
        { title: cancelLabel, isCloseAffordance: true }
      );

      if (consent?.title !== confirmLabel) {
        throw new Error(t('errors.efficiencyActivationCancelled'));
      }

      const auth = await this.authReader.readTokens(profile.userDataDir);
      if (!auth?.accessToken) {
        throw new Error(t('errors.noAccessToken'));
      }

      try {
        await this.apiKeyManager.createApiKey(profileId, auth.accessToken);
      } catch (error) {
        if (error instanceof ApiKeyManagerError) {
          throw new Error(error.message);
        }
        throw error;
      }

      const updated = await this.profileManager.updateProfile(profileId, {
        efficiencyAnalysisEnabled: true,
      });

      await this.poller?.resetState();
      await this.syncPollerWithProfiles();

      extensionLog.info(
        `[EfficiencyService] Enabled efficiency analysis for ${profile.email}`
      );

      return {
        profile: updated,
        message: t('efficiency.activated', { name: profile.displayName }),
      };
    }

    await this.apiKeyManager.deleteApiKey(profileId);
    const updated = await this.profileManager.updateProfile(profileId, {
      efficiencyAnalysisEnabled: false,
    });

    await this.syncPollerWithProfiles();

    return {
      profile: updated,
      message: t('efficiency.deactivated', { name: profile.displayName }),
    };
  }

  async restartPromptDetector(): Promise<void> {
    await this.poller?.resetState();
    this.poller?.stop();
    this.poller = undefined;
    const profiles = await this.profileManager.getProfiles();
    if (profiles.some((p) => p.efficiencyAnalysisEnabled)) {
      this.startPoller();
    }
    vscode.window.showInformationMessage(t('efficiency.restartDetector'));
  }
}
