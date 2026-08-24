import { randomUUID } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as extensionLog from '../logging/extensionLog';
import {
  emailToSlug,
  generateUniqueSlug,
  validateSlug,
} from '../utils/emailToSlug';
import { pathsEqual, validateUserDataPath } from '../utils/pathUtils';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IProfileStorage } from '../domain/ports/IProfileStorage';
import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type {
  CreateProfileOptions,
  Profile,
  ProfileConfig,
  ValidationResult} from './types';
import {
  PROFILE_DIR_PREFIX
} from './types';

export class ProfileManagerError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProfileManagerError';
  }
}

export class ProfileManager implements IProfileManager {
  private readonly storage: IProfileStorage;
  private readonly profileRootDir: string;
  private config: ProfileConfig | null = null;

  constructor(storage: IProfileStorage, profileRootDir = os.homedir()) {
    this.storage = storage;
    this.profileRootDir = profileRootDir;
  }

  /**
   * Initialize the manager by loading configuration.
   */
  async initialize(): Promise<void> {
    this.config = await this.storage.load();
    extensionLog.debug(
      `[ProfileManager] Loaded configuration from ${this.storage.getConfigPath()}`
    );
  }

  private async ensureLoaded(): Promise<ProfileConfig> {
    if (!this.config) {
      this.config = await this.storage.load();
    }
    return this.config;
  }

  /**
   * Get all profiles.
   */
  async getProfiles(): Promise<Profile[]> {
    const config = await this.ensureLoaded();
    return [...config.profiles];
  }

  /**
   * Get a profile by ID.
   */
  async getProfile(id: string): Promise<Profile | undefined> {
    const config = await this.ensureLoaded();
    return config.profiles.find((p) => p.id === id);
  }

  /**
   * Find profile by email address.
   */
  async findProfileByEmail(email: string): Promise<Profile | undefined> {
    const config = await this.ensureLoaded();
    return config.profiles.find(
      (p) => p.email.toLowerCase() === email.toLowerCase()
    );
  }

  /**
   * Find profile by user data directory path.
   * Uses consistent path normalization for cross-platform compatibility.
   */
  async findProfileByPath(userDataDir: string): Promise<Profile | undefined> {
    const config = await this.ensureLoaded();
    return config.profiles.find((p) => pathsEqual(p.userDataDir, userDataDir));
  }

  /**
   * Create a new profile.
   */
  async createProfile(options: CreateProfileOptions): Promise<Profile> {
    const config = await this.ensureLoaded();

    const emailValidation = this.validateEmail(options.email);
    if (!emailValidation.valid) {
      throw new ProfileManagerError(
        `Invalid email: ${emailValidation.errors.join(', ')}`
      );
    }

    const existing = await this.findProfileByEmail(options.email);
    if (existing) {
      throw new ProfileManagerError(
        `Profile with email ${options.email} already exists`
      );
    }

    const slug = emailToSlug(options.email);
    if (!validateSlug(slug)) {
      throw new ProfileManagerError(`Generated slug "${slug}" is invalid`);
    }

    let userDataDir = path.join(
      this.profileRootDir,
      `${PROFILE_DIR_PREFIX}${slug}`
    );

    const existingPath = await this.findProfileByPath(userDataDir);
    if (existingPath) {
      const uniqueSlug = generateUniqueSlug(options.email, true);
      userDataDir = path.join(
        this.profileRootDir,
        `${PROFILE_DIR_PREFIX}${uniqueSlug}`
      );

      const stillExists = await this.findProfileByPath(userDataDir);
      if (stillExists) {
        throw new ProfileManagerError(
          `Unable to generate unique path for email ${options.email}. ` +
            `Both ${slug} and ${uniqueSlug} already exist.`
        );
      }

      extensionLog.info(
        `[ProfileManager] Path collision resolved: ${slug} → ${uniqueSlug}`
      );
    }

    const profile: Profile = {
      id: randomUUID(),
      email: options.email,
      slug,
      displayName:
        options.displayName ?? this.generateDisplayName(options.email),
      userDataDir,
      created: new Date().toISOString(),
      theme: options.theme,
      color: options.color ?? this.generateRandomColor(),
      emoji: options.emoji,
      proxyEnabled: true,
      metadata: {
        source: 'manual',
        notes: options.notes,
        tags: options.tags,
      },
    };

    config.profiles.push(profile);
    await this.storage.save(config);

    extensionLog.info(
      `[ProfileManager] Created profile ${profile.id} (${profile.email})`
    );

    return profile;
  }

  /**
   * Update an existing profile.
   */
  async updateProfile(
    id: string,
    updates: Partial<Profile>
  ): Promise<Profile> {
    const config = await this.ensureLoaded();

    const index = config.profiles.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new ProfileManagerError(`Profile with ID ${id} not found`);
    }

    if (updates.email) {
      const emailValidation = this.validateEmail(updates.email);
      if (!emailValidation.valid) {
        throw new ProfileManagerError(
          `Invalid email: ${emailValidation.errors.join(', ')}`
        );
      }

      const duplicate = config.profiles.find(
        (p) =>
          p.id !== id &&
          p.email.toLowerCase() === updates.email!.toLowerCase()
      );
      if (duplicate) {
        throw new ProfileManagerError(
          `Profile with email ${updates.email} already exists`
        );
      }
    }

    const profile = config.profiles[index];
    if (!profile) {
      throw new ProfileManagerError(`Profile with ID ${id} not found`);
    }
    config.profiles[index] = {
      ...profile,
      ...updates,
      id: profile.id,
      slug: profile.slug,
      userDataDir: profile.userDataDir,
      created: profile.created,
    };

    await this.storage.save(config);

    const updated = config.profiles[index];
    if (!updated) {
      throw new ProfileManagerError(`Profile with ID ${id} not found after update`);
    }
    return updated;
  }

  /**
   * Delete a profile.
   */
  async deleteProfile(
    id: string,
    instanceDetector?: IInstanceDetector
  ): Promise<void> {
    const config = await this.ensureLoaded();

    const index = config.profiles.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new ProfileManagerError(`Profile with ID ${id} not found`);
    }

    if (instanceDetector) {
      const isRunning = await instanceDetector.isProfileRunning(id);
      if (isRunning) {
        const profile = config.profiles[index];
        if (!profile) {
          throw new ProfileManagerError(`Profile with ID ${id} not found`);
        }
        throw new ProfileManagerError(
          `Cannot delete running profile "${profile.displayName}". ` +
            `Close the Cursor window first.`
        );
      }
    }

    const removed = config.profiles[index];
    if (!removed) {
      throw new ProfileManagerError(`Profile with ID ${id} not found`);
    }
    config.profiles.splice(index, 1);
    await this.storage.save(config);

    extensionLog.info(
      `[ProfileManager] Deleted profile ${id} (${removed.email})`
    );
  }

  /**
   * Validate an email address.
   */
  validateEmail(email: string): ValidationResult {
    const errors: string[] = [];

    if (!email || typeof email !== 'string') {
      errors.push('Email must be a non-empty string');
      return { valid: false, errors };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      errors.push('Email format is invalid');
    }

    if (email.length > 254) {
      errors.push('Email is too long (max 254 characters)');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if a profile path is valid and doesn't conflict.
   */
  async isProfilePathValid(userDataDir: string): Promise<boolean> {
    const validation = validateUserDataPath(userDataDir);
    if (!validation.valid) {
      return false;
    }

    const existing = await this.findProfileByPath(userDataDir);
    return !existing;
  }

  /**
   * Create a backup of the current configuration.
   */
  async backup(): Promise<string> {
    return await this.storage.backup();
  }

  /**
   * Get profile manager statistics.
   */
  async getStats(): Promise<{
    totalProfiles: number;
    profilesWithTheme: number;
    averageAge: number;
  }> {
    const config = await this.ensureLoaded();
    const now = Date.now();

    const ages = config.profiles.map((p) => {
      const created = new Date(p.created).getTime();
      return now - created;
    });

    return {
      totalProfiles: config.profiles.length,
      profilesWithTheme: config.profiles.filter((p) => p.theme).length,
      averageAge:
        ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 0,
    };
  }

  private generateDisplayName(email: string): string {
    const localPart = email.split('@')[0] ?? email;
    return localPart
      .replace(/[._]/g, ' ')
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private generateRandomColor(): string {
    const colors = [
      '#3b82f6',
      '#ef4444',
      '#10b981',
      '#f59e0b',
      '#8b5cf6',
      '#ec4899',
      '#06b6d4',
      '#f97316',
    ];
    const color = colors[Math.floor(Math.random() * colors.length)];
    return color ?? '#3b82f6';
  }
}
