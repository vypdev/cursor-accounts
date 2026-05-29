import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { ApiKeyManager } from './apiKeyManager';
import { ProfileDetector } from '../profiles/profileDetector';
import { ProfileManager } from '../profiles/profileManager';
import * as extensionLog from '../logging/extensionLog';
import { getEfficiencyMetadataDir } from './paths';
import { OutputPresenter } from './outputPresenter';
import { SdkClassifier } from './sdkClassifier';
import { PromptMetadata } from './types';

export class MetadataWatcher {
  private watcher?: vscode.FileSystemWatcher;
  private readonly processing = new Set<string>();
  private inFlight = 0;
  private readonly maxConcurrent = 2;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileManager: ProfileManager,
    private readonly profileDetector: ProfileDetector,
    private readonly apiKeyManager: ApiKeyManager,
    private readonly sdkClassifier: SdkClassifier,
    private readonly outputPresenter: OutputPresenter
  ) {}

  start(): void {
    const metadataDir = getEfficiencyMetadataDir(this.context);
    void fs.mkdir(metadataDir, { recursive: true });

    const pattern = new vscode.RelativePattern(metadataDir, 'prompt-*.json');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, false);

    this.watcher.onDidCreate((uri) => {
      void this.handleNewMetadata(uri);
    });

    extensionLog.info(
      `[MetadataWatcher] Watching ${metadataDir} for prompt metadata`
    );
  }

  stop(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  private async handleNewMetadata(uri: vscode.Uri): Promise<void> {
    const filename = path.basename(uri.fsPath);
    if (this.processing.has(filename)) {
      return;
    }

    if (this.inFlight >= this.maxConcurrent) {
      extensionLog.debug(
        `[MetadataWatcher] Deferring ${filename} (${this.inFlight} in flight)`
      );
      return;
    }

    this.processing.add(filename);
    this.inFlight += 1;

    try {
      const content = await fs.readFile(uri.fsPath, 'utf8');
      const metadata = JSON.parse(content) as PromptMetadata;

      const profile = await this.profileDetector.detectCurrentProfile();
      if (!profile?.efficiencyAnalysisEnabled) {
        await this.safeUnlink(uri.fsPath);
        return;
      }

      const apiKey = await this.apiKeyManager.getApiKey(profile.id);
      if (!apiKey) {
        extensionLog.warn(
          `[MetadataWatcher] No API key for profile ${profile.id}; skip analysis`
        );
        this.outputPresenter.presentError(
          'No hay API key de eficiencia para este perfil. Reactiva el análisis en Accounts.',
          metadata
        );
        await this.safeUnlink(uri.fsPath);
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

      await this.safeUnlink(uri.fsPath);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown analysis error';
      extensionLog.error(`[MetadataWatcher] ${message}`);
      try {
        const content = await fs.readFile(uri.fsPath, 'utf8');
        const metadata = JSON.parse(content) as PromptMetadata;
        this.outputPresenter.presentError(message, metadata);
      } catch {
        this.outputPresenter.presentError(message);
      }
      await this.safeUnlink(uri.fsPath);
    } finally {
      this.processing.delete(filename);
      this.inFlight -= 1;
    }
  }

  private async safeUnlink(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch {
      // File may already be removed.
    }
  }
}
