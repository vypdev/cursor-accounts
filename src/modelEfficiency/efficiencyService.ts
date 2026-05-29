import * as vscode from 'vscode';
import { getProfileStateDbPath } from '../auth/cursorPaths';
import { readAuthFromStateDb } from '../auth/tokenReader';
import * as extensionLog from '../logging/extensionLog';
import { Profile } from '../profiles/types';
import { ProfileManager } from '../profiles/profileManager';
import { ApiKeyManager, ApiKeyManagerError } from './apiKeyManager';
import {
  installEfficiencyHook,
  isEfficiencyHookInstalled,
  uninstallEfficiencyHook,
} from './hookInstaller';
import { MetadataWatcher } from './metadataWatcher';
import { OutputPresenter } from './outputPresenter';
import { CursorSdkClassifier } from './sdkClassifier';
import { ProfileDetector } from '../profiles/profileDetector';

const EFFICIENCY_CONSENT_MESSAGE =
  'Se creará una API key de Cursor llamada "Cursor Accounts - API Key" vinculada a esta cuenta para analizar la eficiencia del modelo en segundo plano.';

export class EfficiencyService {
  private readonly apiKeyManager: ApiKeyManager;
  private readonly outputPresenter: OutputPresenter;
  private readonly sdkClassifier = new CursorSdkClassifier();
  private metadataWatcher?: MetadataWatcher;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileManager: ProfileManager,
    private readonly profileDetector: ProfileDetector
  ) {
    this.apiKeyManager = new ApiKeyManager(context);
    this.outputPresenter = new OutputPresenter();
  }

  getOutputPresenter(): OutputPresenter {
    return this.outputPresenter;
  }

  async initialize(): Promise<void> {
    const profiles = await this.profileManager.getProfiles();
    if (profiles.some((p) => p.efficiencyAnalysisEnabled)) {
      await this.ensureHookInstalled();
      this.startWatcher();
    }
  }

  dispose(): void {
    this.metadataWatcher?.stop();
    this.metadataWatcher = undefined;
    this.outputPresenter.dispose();
  }

  private startWatcher(): void {
    if (this.metadataWatcher) {
      return;
    }

    this.metadataWatcher = new MetadataWatcher(
      this.context,
      this.profileManager,
      this.profileDetector,
      this.apiKeyManager,
      this.sdkClassifier,
      this.outputPresenter
    );
    this.metadataWatcher.start();
  }

  private async ensureHookInstalled(): Promise<void> {
    const installed = await isEfficiencyHookInstalled(this.context.extensionPath);
    if (!installed) {
      await installEfficiencyHook(this.context);
    }
  }

  private async syncHookWithProfiles(): Promise<void> {
    const profiles = await this.profileManager.getProfiles();
    const anyEnabled = profiles.some((p) => p.efficiencyAnalysisEnabled);

    if (anyEnabled) {
      await this.ensureHookInstalled();
      this.startWatcher();
    } else {
      this.metadataWatcher?.stop();
      this.metadataWatcher = undefined;
      await uninstallEfficiencyHook(this.context.extensionPath);
    }
  }

  async setEfficiencyEnabled(
    profileId: string,
    enabled: boolean
  ): Promise<{ profile: Profile; message: string }> {
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

      await this.syncHookWithProfiles();

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

    await this.syncHookWithProfiles();

    return {
      profile: updated,
      message: `Análisis de eficiencia desactivado para ${profile.displayName}`,
    };
  }

  async reinstallHook(): Promise<void> {
    await installEfficiencyHook(this.context);
    vscode.window.showInformationMessage(
      'Hook de análisis de eficiencia reinstalado en ~/.cursor/hooks.json'
    );
  }
}
