import * as fs from 'fs/promises';
import * as path from 'path';
import { validateUserDataPath } from '../utils/pathUtils';
import { ProfileExporter } from './profileExporter';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type {
  ExportedProfile,
  ImportOptions,
  ImportResult,
  ImportValidationResult,
  Profile,
  ProfileExport,
  ProfileMetadata} from './types';
import {
  PROFILE_EXPORT_VERSION
} from './types';

const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  skipDuplicates: true,
  overwriteExisting: false,
  importSettings: false,
  strictValidation: true,
};

interface ProfileImportContext {
  existing: Profile[];
  existingEmails: Set<string>;
  result: ImportResult;
}

export class ProfileImporterError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProfileImporterError';
  }
}

export class ProfileImporter {
  constructor(private readonly profileManager: IProfileManager) {}

  /**
   * Import profiles from JSON data.
   */
  async importProfiles(
    exportData: ProfileExport,
    options: Partial<ImportOptions> = {}
  ): Promise<ImportResult> {
    const opts = { ...DEFAULT_IMPORT_OPTIONS, ...options };

    if (opts.strictValidation && !ProfileExporter.validateExport(exportData)) {
      throw new ProfileImporterError('Invalid export data format');
    }

    const migrated = this.resolveExportVersion(exportData);
    if (!migrated) {
      throw new ProfileImporterError(
        `Incompatible export version ${exportData.version}. ` +
          `Current version: ${PROFILE_EXPORT_VERSION}. Migration not available. ` +
          `Please export/import using the same extension version.`
      );
    }

    exportData = migrated;

    const result: ImportResult = {
      success: false,
      imported: [],
      skipped: [],
      errors: [],
    };

    const existing = await this.profileManager.getProfiles();
    const context: ProfileImportContext = {
      existing,
      existingEmails: new Set(existing.map((p) => p.email.toLowerCase())),
      result,
    };

    for (const exported of exportData.profiles) {
      await this.importSingleProfile(exported, opts, context);
    }

    result.success = result.errors.length === 0;
    return result;
  }

  private async importSingleProfile(
    exported: ExportedProfile,
    options: ImportOptions,
    context: ProfileImportContext
  ): Promise<void> {
    try {
      const emailLower = exported.email.toLowerCase();
      const existingProfile = context.existing.find(
        (profile) => profile.email.toLowerCase() === emailLower
      );

      if (context.existingEmails.has(emailLower)) {
        const handled = await this.handleExistingProfile(
          existingProfile,
          exported,
          options,
          context
        );
        if (handled) {
          return;
        }
      }

      context.result.imported.push(
        await this.createProfileFromExport(exported, options)
      );
      context.existingEmails.add(emailLower);
    } catch (error) {
      context.result.errors.push({
        profile: exported,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async handleExistingProfile(
    existingProfile: Profile | undefined,
    exported: ExportedProfile,
    options: ImportOptions,
    context: ProfileImportContext
  ): Promise<boolean> {
    if (options.skipDuplicates && !options.overwriteExisting) {
      context.result.skipped.push(exported);
      return true;
    }

    if (!options.overwriteExisting) {
      return false;
    }

    if (existingProfile) {
      context.result.imported.push(
        await this.updateProfileFromExport(existingProfile, exported, options)
      );
    }
    return true;
  }

  /**
   * Import profiles from a JSON file.
   */
  async importFromFile(
    filePath: string,
    options: Partial<ImportOptions> = {}
  ): Promise<ImportResult> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const exportData = JSON.parse(content) as ProfileExport;

      return await this.importProfiles(exportData, options);
    } catch (error) {
      if (error instanceof ProfileImporterError) {
        throw error;
      }

      throw new ProfileImporterError(
        `Failed to import from file: ${filePath}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Import profiles from JSON string.
   */
  async importFromString(
    json: string,
    options: Partial<ImportOptions> = {}
  ): Promise<ImportResult> {
    try {
      const exportData = JSON.parse(json) as ProfileExport;
      return await this.importProfiles(exportData, options);
    } catch (error) {
      if (error instanceof ProfileImporterError) {
        throw error;
      }

      throw new ProfileImporterError(
        'Failed to parse import data',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Validate export data before import.
   */
  async validateImport(exportData: ProfileExport): Promise<ImportValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!ProfileExporter.validateExport(exportData)) {
      errors.push('Invalid export file format');
      return { valid: false, errors, warnings };
    }

    if (exportData.version !== PROFILE_EXPORT_VERSION) {
      warnings.push(
        `Export version ${exportData.version} may not be fully compatible`
      );
    }

    const existing = await this.profileManager.getProfiles();
    const existingEmails = new Set(existing.map((p) => p.email.toLowerCase()));

    let duplicateCount = 0;
    for (const profile of exportData.profiles) {
      if (existingEmails.has(profile.email.toLowerCase())) {
        duplicateCount++;
      }

      const validation = this.profileManager.validateEmail(profile.email);
      if (!validation.valid) {
        errors.push(`Invalid email: ${profile.email}`);
      }
    }

    if (duplicateCount > 0) {
      warnings.push(
        `${duplicateCount} profile(s) already exist and will be skipped`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private resolveExportVersion(data: ProfileExport): ProfileExport | null {
    if (data.version === PROFILE_EXPORT_VERSION) {
      return data;
    }

    return this.migrateExportFormat(data, PROFILE_EXPORT_VERSION);
  }

  private async createProfileFromExport(
    exported: ExportedProfile,
    options: ImportOptions
  ): Promise<Profile> {
    const profile = await this.profileManager.createProfile({
      email: exported.email,
      displayName: exported.displayName,
      theme: exported.theme,
      color: exported.color,
      emoji: exported.emoji,
      notes: exported.metadata?.notes,
      tags: exported.metadata?.tags,
    });

    const updated = await this.profileManager.updateProfile(profile.id, {
      metadata: this.buildImportedMetadata(exported.metadata),
    });

    return this.finalizeImportedProfile(updated, exported, options);
  }

  private async updateProfileFromExport(
    profile: Profile,
    exported: ExportedProfile,
    options: ImportOptions
  ): Promise<Profile> {
    const updated = await this.profileManager.updateProfile(profile.id, {
      displayName: exported.displayName,
      theme: exported.theme,
      color: exported.color,
      emoji: exported.emoji,
      metadata: this.buildImportedMetadata(exported.metadata),
    });

    return this.finalizeImportedProfile(updated, exported, options);
  }

  private buildImportedMetadata(metadata?: ProfileMetadata): ProfileMetadata {
    return {
      ...metadata,
      source: 'imported',
    };
  }

  private async finalizeImportedProfile(
    updated: Profile,
    exported: ExportedProfile,
    options: ImportOptions
  ): Promise<Profile> {
    if (options.importSettings && exported.settings) {
      await this.writeProfileSettings(updated.userDataDir, exported.settings);
    }

    return updated;
  }

  private async writeProfileSettings(
    userDataDir: string,
    settings: Record<string, unknown>
  ): Promise<void> {
    const validation = validateUserDataPath(userDataDir);
    if (!validation.valid) {
      throw new ProfileImporterError(
        `Invalid profile path: ${validation.error ?? 'unknown error'}`
      );
    }

    const userDir = path.join(userDataDir, 'User');
    await fs.mkdir(userDir, { recursive: true });

    const settingsPath = path.join(userDir, 'settings.json');
    const json = JSON.stringify(settings, null, 2);

    await fs.writeFile(settingsPath, json, 'utf-8');
  }

  /**
   * Migrate export data to target version.
   * Returns null if migration is not available.
   */
  private migrateExportFormat(
    data: ProfileExport,
    targetVersion: string
  ): ProfileExport | null {
    return data.version === targetVersion ? data : null;
  }
}
