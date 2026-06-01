import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as extensionLog from '../logging/extensionLog';
import { validateUserDataPath } from '../utils/pathUtils';
import { profileExportSchema } from '../validation/apiSchemas';
import type { ProfileManager } from './profileManager';
import type {
  ExportedProfile,
  Profile,
  ProfileExport,
  ProfileMetadata} from './types';
import {
  PROFILE_EXPORT_VERSION
} from './types';

export class ProfileExporterError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProfileExporterError';
  }
}

const SENSITIVE_SETTING_KEY_PATTERN =
  /(token|secret|password|api[_-]?key|credential)/i;

export class ProfileExporter {
  constructor(private readonly profileManager: ProfileManager) {}

  /**
   * Export profiles to JSON format.
   */
  async exportProfiles(
    profileIds: string[],
    includeSettings = false
  ): Promise<ProfileExport> {
    const profiles = await this.profileManager.getProfiles();
    const toExport = profiles.filter((p) => profileIds.includes(p.id));

    if (toExport.length === 0) {
      throw new ProfileExporterError('No profiles selected for export');
    }

    const exportedProfiles: ExportedProfile[] = [];

    for (const profile of toExport) {
      exportedProfiles.push(
        await this.exportSingleProfile(profile, includeSettings)
      );
    }

    return {
      version: PROFILE_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: os.hostname(),
      profiles: exportedProfiles,
    };
  }

  /**
   * Export profiles to a JSON file.
   */
  async exportToFile(
    profileIds: string[],
    filePath: string,
    includeSettings = false
  ): Promise<void> {
    const exportData = await this.exportProfiles(profileIds, includeSettings);
    const json = JSON.stringify(exportData, null, 2);

    await fs.writeFile(filePath, json, 'utf-8');
  }

  /**
   * Export all profiles to a JSON file.
   */
  async exportAllToFile(
    filePath: string,
    includeSettings = false
  ): Promise<void> {
    const profiles = await this.profileManager.getProfiles();
    const profileIds = profiles.map((p) => p.id);

    await this.exportToFile(profileIds, filePath, includeSettings);
  }

  /**
   * Validate export data format.
   */
  static validateExport(data: unknown): data is ProfileExport {
    return profileExportSchema.safeParse(data).success;
  }

  private async exportSingleProfile(
    profile: Profile,
    includeSettings: boolean
  ): Promise<ExportedProfile> {
    const exported: ExportedProfile = {
      email: profile.email,
      displayName: profile.displayName,
      theme: profile.theme,
      color: profile.color,
      emoji: profile.emoji,
      metadata: this.sanitizeMetadata(profile.metadata),
    };

    if (includeSettings) {
      try {
        const settings = await this.readProfileSettings(profile.userDataDir);
        if (settings) {
          exported.settings = settings;
        }
      } catch (error) {
        extensionLog.warn(
          `[ProfileExporter] Could not read settings for ${profile.email}: ${extensionLog.formatError(error)}`
        );
      }
    }

    return exported;
  }

  private sanitizeMetadata(
    metadata?: ProfileMetadata
  ): ProfileMetadata | undefined {
    if (!metadata) {
      return undefined;
    }

    const { source, notes, tags } = metadata;
    const sanitized: ProfileMetadata = {};

    if (source) {
      sanitized.source = source;
    }
    if (notes) {
      sanitized.notes = notes;
    }
    if (tags) {
      sanitized.tags = tags;
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }

  /**
   * Read settings.json from a profile's user data directory.
   */
  private async readProfileSettings(
    userDataDir: string
  ): Promise<Record<string, unknown> | null> {
    const validation = validateUserDataPath(userDataDir);
    if (!validation.valid) {
      throw new ProfileExporterError(
        `Invalid profile path: ${validation.error ?? 'unknown error'}`
      );
    }

    const settingsPath = path.join(userDataDir, 'User', 'settings.json');

    try {
      const content = await fs.readFile(settingsPath, 'utf-8');
      const jsonContent = this.stripJsonComments(content);
      const parsed = JSON.parse(jsonContent) as Record<string, unknown>;

      return this.sanitizeSettings(parsed);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Strip comments from JSON (VS Code settings.json allows comments).
   */
  stripJsonComments(json: string): string {
    let result = json.replace(/\/\/.*$/gm, '');
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');
    return result;
  }

  /**
   * Remove sensitive keys from settings before export.
   */
  sanitizeSettings(
    settings: Record<string, unknown>
  ): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(settings)) {
      if (SENSITIVE_SETTING_KEY_PATTERN.test(key)) {
        continue;
      }

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeSettings(
          value as Record<string, unknown>
        );
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}
