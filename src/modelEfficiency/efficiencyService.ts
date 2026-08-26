import * as vscode from 'vscode';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import * as extensionLog from '../logging/extensionLog';
import { t } from '../l10n';
import type { Profile } from '../profiles/types';
import type { IProfileWriter } from '../domain/ports/IProfileWriter';
import { ApiKeyManager } from './apiKeyManager';
import { ComposerDbPoller } from './composerDbPoller';
import { EfficiencyAnalyzer } from './efficiencyAnalyzer';
import type {
  EfficiencyAnalyzerPort,
  EfficiencyApiKeyStore,
  EfficiencyOutputPresenter,
  EfficiencyPoller,
} from './efficiencyPorts';
import type { EfficiencyStatsStorage } from './efficiencyStatsStorage';
import { OutputPresenter } from './outputPresenter';
import { CursorSdkClassifier } from './sdkClassifier';
import type { MultiProfileQuotaService } from '../services/multiProfileQuotaService';
import { EfficiencyToggleWorkflow } from './efficiencyToggleWorkflow';

export { getEfficiencyWrongWindowMessage } from './efficiencyToggleWorkflow';

export interface EfficiencyServiceDependencies {
  apiKeyStore?: EfficiencyApiKeyStore;
  outputPresenter?: EfficiencyOutputPresenter;
  analyzer?: EfficiencyAnalyzerPort;
  createPoller?: (
    context: vscode.ExtensionContext,
    profileDetector: IProfileDetector,
    extensionPath: string,
    analyzer: EfficiencyAnalyzerPort
  ) => EfficiencyPoller;
  requestActivationConsent?: () => Promise<boolean>;
}

export class EfficiencyService {
  private readonly apiKeyManager: EfficiencyApiKeyStore;
  private readonly outputPresenter: EfficiencyOutputPresenter;
  private readonly analyzer: EfficiencyAnalyzerPort;
  private poller?: EfficiencyPoller;
  private readonly createPoller: NonNullable<
    EfficiencyServiceDependencies['createPoller']
  >;
  private readonly toggleWorkflow: EfficiencyToggleWorkflow;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileWriter: IProfileWriter,
    private readonly profileDetector: IProfileDetector,
    authReader: IProfileAuthReader,
    private readonly statsStorage: EfficiencyStatsStorage,
    private readonly multiProfileQuotaService: MultiProfileQuotaService,
    dependencies: EfficiencyServiceDependencies = {}
  ) {
    this.apiKeyManager = dependencies.apiKeyStore ?? new ApiKeyManager(context);
    this.outputPresenter = dependencies.outputPresenter ?? new OutputPresenter();
    this.analyzer =
      dependencies.analyzer ??
      new EfficiencyAnalyzer(
        profileWriter,
        profileDetector,
        this.apiKeyManager,
        new CursorSdkClassifier(),
        this.outputPresenter,
        this.statsStorage,
        this.multiProfileQuotaService
      );
    this.createPoller =
      dependencies.createPoller ??
      ((pollerContext, detector, extensionPath, analyzer) =>
        new ComposerDbPoller(
          pollerContext,
          detector,
          extensionPath,
          analyzer
        ));
    this.toggleWorkflow = new EfficiencyToggleWorkflow({
      profileWriter,
      profileDetector,
      authReader,
      apiKeyStore: this.apiKeyManager,
      statsStorage,
      requestActivationConsent:
        dependencies.requestActivationConsent ??
        (() => requestActivationConsent()),
    });
  }

  getStatsStorage(): EfficiencyStatsStorage {
    return this.statsStorage;
  }

  getOutputPresenter(): EfficiencyOutputPresenter {
    return this.outputPresenter;
  }

  async initialize(): Promise<void> {
    const profiles = await this.profileWriter.getProfiles();
    await this.statsStorage.loadAllStats(profiles);
    if (profiles.some((p) => p.efficiencyAnalysisEnabled)) {
      await this.startPoller();
    }
  }

  dispose(): void {
    this.poller?.stop();
    this.poller = undefined;
    this.outputPresenter.dispose();
  }

  private async startPoller(resetState = false): Promise<void> {
    if (this.poller) {
      if (resetState) {
        await this.poller.resetState();
      }
      return;
    }

    const poller = this.createPoller(
      this.context,
      this.profileDetector,
      this.context.extensionPath,
      this.analyzer
    );
    if (resetState) {
      await poller.resetState();
    }
    this.poller = poller;
    poller.start();
  }

  private async syncPollerWithProfiles(resetState = false): Promise<void> {
    const profiles = await this.profileWriter.getProfiles();
    const anyEnabled = profiles.some((p) => p.efficiencyAnalysisEnabled);

    if (anyEnabled) {
      await this.startPoller(resetState);
    } else {
      this.poller?.stop();
      this.poller = undefined;
    }
  }

  async setEfficiencyEnabled(
    profileId: string,
    enabled: boolean
  ): Promise<{ profile: Profile; message: string }> {
    const result = await this.toggleWorkflow.execute(profileId, enabled);
    if (enabled) {
      await this.syncPollerWithProfiles(true);
      extensionLog.info(
        `[EfficiencyService] Enabled efficiency analysis for ${result.profile.email}`
      );
    } else {
      await this.syncPollerWithProfiles();
    }
    return result;
  }

  async restartPromptDetector(): Promise<void> {
    await this.poller?.resetState();
    this.poller?.stop();
    this.poller = undefined;
    const profiles = await this.profileWriter.getProfiles();
    if (profiles.some((p) => p.efficiencyAnalysisEnabled)) {
      await this.startPoller();
    }
    vscode.window.showInformationMessage(t('efficiency.restartDetector'));
  }
}

async function requestActivationConsent(): Promise<boolean> {
  const confirmLabel = t('efficiency.consent.confirm');
  const cancelLabel = t('efficiency.consent.cancel');
  const consent = await vscode.window.showInformationMessage(
    t('efficiency.consent.message'),
    { modal: true },
    { title: confirmLabel },
    { title: cancelLabel, isCloseAffordance: true }
  );
  return consent?.title === confirmLabel;
}
