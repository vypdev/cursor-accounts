import type * as vscode from 'vscode';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileStorageAnalyzer } from '../domain/ports/IProfileStorageAnalyzer';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { IStorageCleanupService } from '../domain/ports/IStorageCleanupService';
import type { EfficiencyService } from '../modelEfficiency/efficiencyService';
import type { InstanceDetector } from '../profiles/instanceDetector';
import { StorageCleanupService } from '../services/storageCleanupService';
import { NodeFileSystemService } from '../storage/nodeFileSystemService';
import { ProfileStorageAnalyzer } from '../storage/profileStorageAnalyzer';
import { SqliteCleanupService } from '../storage/sqliteCleanupService';
import { VSCodeCacheService } from '../storage/vscodeCacheService';

/** Storage cleanup stack wired for the Accounts panel and handlers. */
export interface AccountsPanelStorageBundle {
  storageCleanupService: IStorageCleanupService;
  storageAnalyzer: IProfileStorageAnalyzer;
}

/**
 * Builds filesystem, analyzer, and cleanup services for profile storage management.
 * Composition root helper — keeps UI free of concrete adapter construction.
 */
export function createAccountsPanelStorageBundle(params: {
  context: vscode.ExtensionContext;
  profileReader: IProfileReader;
  profileDetector: IProfileDetector;
  instanceDetector: InstanceDetector;
  efficiencyService: EfficiencyService;
}): AccountsPanelStorageBundle {
  const fileSystem = new NodeFileSystemService();
  const storageAnalyzer = new ProfileStorageAnalyzer(fileSystem);
  const storageCleanupService = new StorageCleanupService({
    profileManager: params.profileReader,
    profileDetector: params.profileDetector,
    instanceDetector: params.instanceDetector,
    storageAnalyzer,
    cacheCleanup: new VSCodeCacheService({
      context: params.context,
      fileSystem,
      efficiencyService: params.efficiencyService,
      isCurrentProfile: async (profileId) => {
        const current = await params.profileDetector.detectCurrentProfile();
        return current?.id === profileId;
      },
    }),
    databaseCleanup: new SqliteCleanupService({
      extensionPath: params.context.extensionPath,
      fileSystem,
    }),
    extensionPath: params.context.extensionPath,
  });

  return { storageCleanupService, storageAnalyzer };
}
