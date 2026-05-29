import * as vscode from 'vscode';
import { getProfileStateDbPath } from '../auth/cursorPaths';
import { readAuthFromStateDb } from '../auth/tokenReader';
import * as extensionLog from '../logging/extensionLog';
import { Profile } from '../profiles/types';
import { ProfileManager } from '../profiles/profileManager';
import { ApiKeyManager, ApiKeyManagerError } from './apiKeyManager';
import { ComposerDbPoller } from './composerDbPoller';
import { EfficiencyAnalyzer } from './efficiencyAnalyzer';
import { OutputPresenter } from './outputPresenter';
import { CursorSdkClassifier } from './sdkClassifier';
import { ProfileDetector } from '../profiles/profileDetector';

const EFFICIENCY_CONSENT_MESSAGE =
  'Se creará una API key de Cursor llamada "Cursor Accounts - API Key" vinculada a esta cuenta para analizar la eficiencia del modelo en segundo plano.';

export const EFFICIENCY_WRONG_WINDOW_MESSAGE =
  'El análisis de eficiencia solo se puede activar o desactivar en la ventana de ese perfil.';

export class EfficiencyService {
  private readonly apiKeyManager: ApiKeyManager;
  private readonly outputPresenter: OutputPresenter;
  private readonly sdkClassifier = new CursorSdkClassifier();
  private readonly analyzer: EfficiencyAnalyzer;
  private poller?: ComposerDbPoller;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileManager: ProfileManager,
    private readonly profileDetector: ProfileDetector
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
      throw new Error(EFFICIENCY_WRONG_WINDOW_MESSAGE);
    }

    const profile = await this.profileManager.getProfile(profileId);
    if (!profile) {
      throw new Error('Profile not found');
    }

    if (enabled) {
      const consent = await vscode.window.showInformationMessage(
        EFFICIENCY_CONSENT_MESSAGE,
        { modal: true },
        'Crear API key y activar',
        'Cancelar'
      );

      if (consent !== 'Crear API key y activar') {
        throw new Error('Activación cancelada');
      }

      const dbPath = getProfileStateDbPath(profile.userDataDir);
      const auth = await readAuthFromStateDb(
        dbPath,
        this.context.extensionPath
      );
      if (!auth?.accessToken) {
        throw new Error(
          'No access token in profile storage. Sign in to Cursor with this profile first.'
        );
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
        message: `Análisis de eficiencia activado para ${profile.displayName}`,
      };
    }

    await this.apiKeyManager.deleteApiKey(profileId);
    const updated = await this.profileManager.updateProfile(profileId, {
      efficiencyAnalysisEnabled: false,
    });

    await this.syncPollerWithProfiles();

    return {
      profile: updated,
      message: `Análisis de eficiencia desactivado para ${profile.displayName}`,
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
    vscode.window.showInformationMessage(
      'Detector de prompts reiniciado (lectura de state.vscdb cada 10 s).'
    );
  }
}
