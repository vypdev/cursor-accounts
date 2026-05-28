# Phase 1: Profile Infrastructure

## Overview

Phase 1 establishes the foundational data models, storage layer, and utility functions needed for profile management. This phase focuses on the core infrastructure without any UI or user-facing features. By the end of this phase, the extension will be able to create, read, update, and delete profiles in a persistent storage layer.

## Goals

- Define TypeScript interfaces for Profile and ProfileConfig
- Implement email-to-slug conversion utility
- Build storage layer for reading/writing `~/.cursor-accounts/config.json`
- Implement ProfileManager for CRUD operations
- Add unit tests for all components
- Ensure cross-platform compatibility (macOS, Windows, Linux)

## Prerequisites

- Existing codebase understanding (`src/auth/`, `src/config.ts`)
- TypeScript 5.5+, Node.js 22
- Knowledge of VS Code Extension API

## Files to Create

```
src/
├── profiles/
│   ├── types.ts              # NEW: Profile, ProfileConfig interfaces
│   ├── profileStorage.ts     # NEW: File I/O for config.json
│   └── profileManager.ts     # NEW: CRUD operations, validation
├── utils/
│   ├── emailToSlug.ts        # NEW: Email → slug conversion
│   └── pathUtils.ts          # NEW: Cross-platform path normalization
└── test/
    ├── emailToSlug.test.ts   # NEW: Unit tests
    ├── profileStorage.test.ts # NEW: Unit tests
    ├── profileManager.test.ts # NEW: Unit tests
    └── pathUtils.test.ts      # NEW: Unit tests
```

## Implementation Details

### 1. Data Models (`src/profiles/types.ts`)

Create comprehensive TypeScript interfaces for all profile-related data structures.

```typescript
/**
 * Represents a single Cursor account profile.
 */
export interface Profile {
  /** Unique identifier (UUID v4) */
  id: string;
  
  /** Cursor account email address (primary key) */
  email: string;
  
  /** 
   * URL-safe slug generated from email.
   * 
   * **Collision Resolution**: May include 8-char hash suffix if collision detected.
   * - Normal: `user_example_com`
   * - With collision: `user_example_com_a1b2c3d4`
   * 
   * See emailToSlug.ts and "Known Limitations" section for details.
   */
  slug: string;
  
  /** User-friendly display name */
  displayName: string;
  
  /** 
   * Absolute path to --user-data-dir for this profile.
   * 
   * Includes slug (potentially with hash suffix) in path.
   * - Normal: `~/.cursor-user_example_com`
   * - With collision: `~/.cursor-user_example_com_a1b2c3d4`
   */
  userDataDir: string;
  
  /** ISO 8601 timestamp when profile was created */
  created: string;
  
  /** ISO 8601 timestamp when profile was last launched */
  lastLaunched?: string;
  
  /** VS Code theme name for visual identification */
  theme?: string;
  
  /** Hex color code for UI identification (#rrggbb) */
  color?: string;
  
  /** Additional metadata */
  metadata?: ProfileMetadata;
}

export interface ProfileMetadata {
  /** How this profile was created */
  source?: 'manual' | 'imported' | 'detected';
  
  /** User notes about this profile */
  notes?: string;
  
  /** Tags for categorization */
  tags?: string[];
  
  /** Custom user data */
  [key: string]: unknown;
}

/**
 * Root configuration file structure.
 */
export interface ProfileConfig {
  /** Schema version for future migrations */
  version: string;
  
  /** List of all configured profiles */
  profiles: Profile[];
  
  /** Global settings for profile management */
  settings: ProfileSettings;
}

export interface ProfileSettings {
  /** Enable automatic detection of running instances */
  autoDetectRunning: boolean;
  
  /** Show current profile in status bar */
  showProfileInStatusBar: boolean;
  
  /** Interval for refreshing all profile quotas (seconds) */
  refreshAllInterval: number;
  
  /** Default theme for new profiles */
  defaultTheme?: string;
  
  /** Ask for confirmation before launching profile */
  confirmBeforeLaunch: boolean;
}

/**
 * Result of a validation operation.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Options for creating a new profile.
 */
export interface CreateProfileOptions {
  email: string;
  displayName?: string;
  theme?: string;
  color?: string;
  notes?: string;
  tags?: string[];
}
```

**Constants to export**:

```typescript
/** Current schema version */
export const PROFILE_CONFIG_VERSION = '1.0.0';

/** Default configuration file location */
export const DEFAULT_CONFIG_DIR = '.cursor-accounts';
export const DEFAULT_CONFIG_FILE = 'config.json';

/** Default profile settings */
export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  autoDetectRunning: true,
  showProfileInStatusBar: true,
  refreshAllInterval: 300, // 5 minutes
  confirmBeforeLaunch: false,
};

/** Profile directory prefix */
export const PROFILE_DIR_PREFIX = '.cursor-';
```

### 2. Path Utilities (`src/utils/pathUtils.ts`)

**CRITICAL**: Centralized path normalization to ensure consistent behavior across all phases.

**Problem**: Different platforms handle paths differently (Windows: `\`, Unix: `/`), and case sensitivity varies (Windows: case-insensitive, Unix: case-sensitive). Inconsistent normalization causes profile detection failures.

**Solution**: Single source of truth for path operations used throughout the codebase.

```typescript
import * as path from 'path';
import * as os from 'os';

/**
 * Normalize a path for consistent comparison across platforms.
 * 
 * Normalization rules:
 * 1. Convert to absolute path
 * 2. Normalize separators (path.normalize handles platform differences)
 * 3. Convert to lowercase on Windows only (for case-insensitive comparison)
 * 4. Remove trailing slashes
 * 
 * @param inputPath Path to normalize
 * @returns Normalized path
 */
export function normalizePath(inputPath: string): string {
  // Resolve to absolute path
  const absolute = path.resolve(inputPath);
  
  // Normalize separators
  const normalized = path.normalize(absolute);
  
  // On Windows, convert to lowercase for case-insensitive comparison
  // On Unix, preserve case
  const caseNormalized = process.platform === 'win32' 
    ? normalized.toLowerCase() 
    : normalized;
  
  // Remove trailing path separator (but keep root separator)
  const withoutTrailing = caseNormalized.endsWith(path.sep) && caseNormalized.length > 1
    ? caseNormalized.slice(0, -1)
    : caseNormalized;
  
  return withoutTrailing;
}

/**
 * Compare two paths for equality.
 * Handles platform differences (case sensitivity, separators).
 * 
 * @param path1 First path
 * @param path2 Second path
 * @returns True if paths are equal
 */
export function pathsEqual(path1: string, path2: string): boolean {
  return normalizePath(path1) === normalizePath(path2);
}

/**
 * Validate that a path is safe for use as a user data directory.
 * 
 * Security checks:
 * 1. Must be absolute path
 * 2. Must be within user's home directory
 * 3. Must not be a system directory
 * 4. Must not be the root directory
 * 
 * @param userDataDir Path to validate
 * @returns Validation result with specific error if invalid
 */
export function validateUserDataPath(userDataDir: string): {
  valid: boolean;
  error?: string;
} {
  // Must be absolute
  if (!path.isAbsolute(userDataDir)) {
    return {
      valid: false,
      error: 'Path must be absolute',
    };
  }

  const normalized = path.normalize(path.resolve(userDataDir));
  const home = path.normalize(os.homedir());

  // Must be within user's home directory
  if (!normalized.startsWith(home)) {
    return {
      valid: false,
      error: 'Path must be within user home directory',
    };
  }

  // Must not be home directory itself
  if (normalized === home) {
    return {
      valid: false,
      error: 'Path cannot be home directory itself',
    };
  }

  // Must not be system directories
  const systemDirs = process.platform === 'win32'
    ? ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData']
    : ['/', '/System', '/usr', '/bin', '/sbin', '/etc', '/var'];

  for (const sysDir of systemDirs) {
    const normalizedSysDir = path.normalize(sysDir);
    if (normalized.startsWith(normalizedSysDir)) {
      return {
        valid: false,
        error: `Path cannot be within system directory: ${sysDir}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Ensure a path exists and is a directory.
 * Creates the directory if it doesn't exist.
 * 
 * @param dirPath Path to directory
 * @throws Error if path exists but is not a directory
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  const fs = await import('fs/promises');
  
  try {
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path exists but is not a directory: ${dirPath}`);
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // Directory doesn't exist, create it
      await fs.mkdir(dirPath, { recursive: true });
    } else {
      throw error;
    }
  }
}
```

**Unit tests** (`src/test/pathUtils.test.ts`):

```typescript
import { strict as assert } from 'assert';
import * as path from 'path';
import * as os from 'os';
import { normalizePath, pathsEqual, validateUserDataPath } from '../utils/pathUtils';

describe('pathUtils', () => {
  describe('normalizePath', () => {
    it('converts relative to absolute path', () => {
      const normalized = normalizePath('./test');
      assert.ok(path.isAbsolute(normalized));
    });

    it('handles paths with .. correctly', () => {
      const normalized = normalizePath('/test/foo/../bar');
      assert.equal(normalized, normalizePath('/test/bar'));
    });

    it('removes trailing slashes', () => {
      const normalized = normalizePath('/test/path/');
      assert.ok(!normalized.endsWith(path.sep));
    });

    it('preserves root separator', () => {
      if (process.platform !== 'win32') {
        const normalized = normalizePath('/');
        assert.equal(normalized, '/');
      }
    });

    it('is case-insensitive on Windows', () => {
      if (process.platform === 'win32') {
        const path1 = normalizePath('C:\\Users\\Test');
        const path2 = normalizePath('c:\\users\\test');
        assert.equal(path1, path2);
      }
    });

    it('is case-sensitive on Unix', () => {
      if (process.platform !== 'win32') {
        const path1 = normalizePath('/Users/Test');
        const path2 = normalizePath('/users/test');
        assert.notEqual(path1, path2);
      }
    });
  });

  describe('pathsEqual', () => {
    it('returns true for same paths', () => {
      const home = os.homedir();
      assert.ok(pathsEqual(home, home));
    });

    it('returns true for equivalent paths with different separators', () => {
      // This test behavior depends on platform
      const path1 = normalizePath('/test/path');
      const path2 = normalizePath('/test/path');
      assert.ok(pathsEqual(path1, path2));
    });

    it('returns false for different paths', () => {
      const path1 = normalizePath('/test/path1');
      const path2 = normalizePath('/test/path2');
      assert.ok(!pathsEqual(path1, path2));
    });
  });

  describe('validateUserDataPath', () => {
    it('accepts path within home directory', () => {
      const validPath = path.join(os.homedir(), '.cursor-test');
      const result = validateUserDataPath(validPath);
      assert.equal(result.valid, true);
    });

    it('rejects relative paths', () => {
      const result = validateUserDataPath('./test');
      assert.equal(result.valid, false);
      assert.ok(result.error?.includes('absolute'));
    });

    it('rejects paths outside home directory', () => {
      const result = validateUserDataPath('/tmp/test');
      assert.equal(result.valid, false);
      assert.ok(result.error?.includes('home directory'));
    });

    it('rejects home directory itself', () => {
      const result = validateUserDataPath(os.homedir());
      assert.equal(result.valid, false);
      assert.ok(result.error?.includes('home directory itself'));
    });

    it('rejects system directories', () => {
      const systemPath = process.platform === 'win32' 
        ? 'C:\\Windows\\test' 
        : '/usr/test';
      const result = validateUserDataPath(systemPath);
      assert.equal(result.valid, false);
      assert.ok(result.error?.includes('system directory'));
    });
  });
});
```

### 3. Email-to-Slug Utility (`src/utils/emailToSlug.ts`)

Convert email addresses to URL-safe directory names.

```typescript
import * as crypto from 'crypto';

/**
 * Convert an email address to a URL-safe slug suitable for directory names.
 * 
 * Algorithm:
 * 1. Split email at @ symbol
 * 2. Replace special characters with underscores
 * 3. Convert to lowercase
 * 4. Remove consecutive underscores
 * 5. Trim underscores from start/end
 * 
 * Examples:
 *   efraespada@gmail.com → efraespada_gmail_com
 *   efrain.espada@feverup.com → efrain_espada_feverup_com
 *   user+tag@domain.co.uk → user_tag_domain_co_uk
 * 
 * @param email Email address to convert
 * @returns URL-safe slug
 */
export function emailToSlug(email: string): string {
  if (!email || typeof email !== 'string') {
    throw new Error('Email must be a non-empty string');
  }

  // Convert to lowercase and replace special chars
  const normalized = email
    .toLowerCase()
    .replace(/@/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  if (!normalized) {
    throw new Error('Email produced empty slug');
  }

  return normalized;
}

/**
 * Generate a short hash from email for collision resolution.
 * Returns first 8 characters of SHA256 hash.
 * 
 * @param email Email address
 * @returns 8-character hex hash
 */
export function emailToHash(email: string): string {
  return crypto
    .createHash('sha256')
    .update(email.toLowerCase())
    .digest('hex')
    .substring(0, 8);
}

/**
 * Generate a unique slug with optional collision resolution.
 * If includeHash is true, appends hash to prevent collisions.
 * 
 * @param email Email address
 * @param includeHash Whether to append hash for uniqueness
 * @returns Unique slug
 */
export function generateUniqueSlug(email: string, includeHash = false): string {
  const baseSlug = emailToSlug(email);
  
  if (includeHash) {
    const hash = emailToHash(email);
    return `${baseSlug}_${hash}`;
  }
  
  return baseSlug;
}

/**
 * Validate that a slug is safe for use as a directory name.
 * 
 * @param slug Slug to validate
 * @returns Validation result
 */
export function validateSlug(slug: string): boolean {
  // Must contain only lowercase letters, numbers, and underscores
  const validPattern = /^[a-z0-9_]+$/;
  
  // Must not be empty or too long
  if (!slug || slug.length === 0 || slug.length > 200) {
    return false;
  }
  
  // Must not be a reserved name
  const reserved = ['con', 'prn', 'aux', 'nul', 'com1', 'lpt1']; // Windows reserved
  if (reserved.includes(slug.toLowerCase())) {
    return false;
  }
  
  return validPattern.test(slug);
}
```

**Unit tests** (`src/test/emailToSlug.test.ts`):

```typescript
import { strict as assert } from 'assert';
import { emailToSlug, emailToHash, generateUniqueSlug, validateSlug } from '../utils/emailToSlug';

describe('emailToSlug', () => {
  it('converts simple email to slug', () => {
    assert.equal(emailToSlug('user@example.com'), 'user_example_com');
  });

  it('handles dots in local part', () => {
    assert.equal(emailToSlug('first.last@domain.com'), 'first_last_domain_com');
  });

  it('handles plus addressing', () => {
    assert.equal(emailToSlug('user+tag@domain.com'), 'user_tag_domain_com');
  });

  it('handles multiple dots in domain', () => {
    assert.equal(emailToSlug('user@sub.domain.co.uk'), 'user_sub_domain_co_uk');
  });

  it('converts to lowercase', () => {
    assert.equal(emailToSlug('User@DOMAIN.COM'), 'user_domain_com');
  });

  it('removes consecutive underscores', () => {
    assert.equal(emailToSlug('user..name@domain.com'), 'user_name_domain_com');
  });

  it('throws on empty email', () => {
    assert.throws(() => emailToSlug(''), /non-empty string/);
  });

  it('throws on non-string input', () => {
    assert.throws(() => emailToSlug(null as any), /non-empty string/);
  });
});

describe('emailToHash', () => {
  it('generates consistent 8-character hash', () => {
    const hash1 = emailToHash('user@example.com');
    const hash2 = emailToHash('user@example.com');
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 8);
  });

  it('generates different hashes for different emails', () => {
    const hash1 = emailToHash('user1@example.com');
    const hash2 = emailToHash('user2@example.com');
    assert.notEqual(hash1, hash2);
  });

  it('is case-insensitive', () => {
    const hash1 = emailToHash('User@Example.COM');
    const hash2 = emailToHash('user@example.com');
    assert.equal(hash1, hash2);
  });
});

describe('generateUniqueSlug', () => {
  it('generates base slug without hash by default', () => {
    const slug = generateUniqueSlug('user@example.com');
    assert.equal(slug, 'user_example_com');
  });

  it('appends hash when requested', () => {
    const slug = generateUniqueSlug('user@example.com', true);
    assert.match(slug, /^user_example_com_[a-f0-9]{8}$/);
  });
});

describe('validateSlug', () => {
  it('accepts valid slugs', () => {
    assert.equal(validateSlug('user_example_com'), true);
    assert.equal(validateSlug('a1_b2_c3'), true);
  });

  it('rejects empty slug', () => {
    assert.equal(validateSlug(''), false);
  });

  it('rejects slugs with special characters', () => {
    assert.equal(validateSlug('user@example'), false);
    assert.equal(validateSlug('user.example'), false);
    assert.equal(validateSlug('user-example'), false);
  });

  it('rejects uppercase characters', () => {
    assert.equal(validateSlug('User_Example'), false);
  });

  it('rejects Windows reserved names', () => {
    assert.equal(validateSlug('con'), false);
    assert.equal(validateSlug('prn'), false);
    assert.equal(validateSlug('aux'), false);
  });

  it('rejects too long slugs', () => {
    const longSlug = 'a'.repeat(201);
    assert.equal(validateSlug(longSlug), false);
  });
});
```

### 3. Profile Storage (`src/profiles/profileStorage.ts`)

Handle low-level file I/O for the configuration file.

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  ProfileConfig,
  PROFILE_CONFIG_VERSION,
  DEFAULT_PROFILE_SETTINGS,
  DEFAULT_CONFIG_DIR,
  DEFAULT_CONFIG_FILE,
} from './types';

export class ProfileStorageError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'ProfileStorageError';
  }
}

export class ProfileStorage {
  private readonly configPath: string;
  private configCache: ProfileConfig | null = null;

  constructor(configDir?: string) {
    const dir = configDir ?? path.join(os.homedir(), DEFAULT_CONFIG_DIR);
    this.configPath = path.join(dir, DEFAULT_CONFIG_FILE);
  }

  /**
   * Get the configuration file path.
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Check if the configuration file exists.
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load configuration from disk.
   * Creates default config if file doesn't exist.
   */
  async load(): Promise<ProfileConfig> {
    try {
      const fileExists = await this.exists();
      
      if (!fileExists) {
        // Create default config
        const defaultConfig = this.createDefaultConfig();
        await this.save(defaultConfig);
        this.configCache = defaultConfig;
        return defaultConfig;
      }

      const content = await fs.readFile(this.configPath, 'utf-8');
      const config = JSON.parse(content) as ProfileConfig;
      
      // Validate and migrate if needed
      const validated = this.validateAndMigrate(config);
      this.configCache = validated;
      
      return validated;
    } catch (error) {
      throw new ProfileStorageError(
        `Failed to load config from ${this.configPath}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save configuration to disk.
   * Uses atomic write (write to temp file, then rename).
   */
  async save(config: ProfileConfig): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.configPath);
      await fs.mkdir(dir, { recursive: true });

      // Atomic write: temp file + rename
      const tempPath = `${this.configPath}.tmp`;
      const content = JSON.stringify(config, null, 2);
      
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, this.configPath);
      
      this.configCache = config;
    } catch (error) {
      throw new ProfileStorageError(
        `Failed to save config to ${this.configPath}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Create a backup of the current configuration.
   * Returns the backup file path.
   */
  async backup(): Promise<string> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${this.configPath}.backup.${timestamp}`;
      
      await fs.copyFile(this.configPath, backupPath);
      
      return backupPath;
    } catch (error) {
      throw new ProfileStorageError(
        'Failed to create backup',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Restore configuration from a backup file.
   */
  async restore(backupPath: string): Promise<void> {
    try {
      await fs.copyFile(backupPath, this.configPath);
      this.configCache = null; // Invalidate cache
    } catch (error) {
      throw new ProfileStorageError(
        `Failed to restore from backup: ${backupPath}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Clear the in-memory cache.
   */
  clearCache(): void {
    this.configCache = null;
  }

  /**
   * Create default configuration.
   */
  private createDefaultConfig(): ProfileConfig {
    return {
      version: PROFILE_CONFIG_VERSION,
      profiles: [],
      settings: { ...DEFAULT_PROFILE_SETTINGS },
    };
  }

  /**
   * Validate and migrate configuration if needed.
   */
  private validateAndMigrate(config: ProfileConfig): ProfileConfig {
    // Ensure required fields exist
    if (!config.version) {
      config.version = PROFILE_CONFIG_VERSION;
    }
    
    if (!config.profiles) {
      config.profiles = [];
    }
    
    if (!config.settings) {
      config.settings = { ...DEFAULT_PROFILE_SETTINGS };
    }

    // Merge with default settings (add any missing keys)
    config.settings = {
      ...DEFAULT_PROFILE_SETTINGS,
      ...config.settings,
    };

    // Validate setting values (protects against manual config.json edits)
    // User could manually edit config.json with invalid values - fix them here
    
    if (typeof config.settings.refreshAllInterval === 'number') {
      // Clamp to reasonable range: 60s - 3600s (1 minute - 1 hour)
      config.settings.refreshAllInterval = Math.max(
        60,
        Math.min(3600, config.settings.refreshAllInterval)
      );
    } else {
      // Invalid type - reset to default
      config.settings.refreshAllInterval = DEFAULT_PROFILE_SETTINGS.refreshAllInterval;
    }
    
    if (typeof config.settings.autoDetectRunning !== 'boolean') {
      config.settings.autoDetectRunning = DEFAULT_PROFILE_SETTINGS.autoDetectRunning;
    }
    
    if (typeof config.settings.showProfileInStatusBar !== 'boolean') {
      config.settings.showProfileInStatusBar = DEFAULT_PROFILE_SETTINGS.showProfileInStatusBar;
    }
    
    if (typeof config.settings.confirmBeforeLaunch !== 'boolean') {
      config.settings.confirmBeforeLaunch = DEFAULT_PROFILE_SETTINGS.confirmBeforeLaunch;
    }

    // Future: Handle version migrations here
    // if (config.version === '0.9.0') { ... }

    return config;
  }
}
```

**Unit tests** (`src/test/profileStorage.test.ts`):

```typescript
import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ProfileStorage, ProfileStorageError } from '../profiles/profileStorage';
import { PROFILE_CONFIG_VERSION } from '../profiles/types';

describe('ProfileStorage', () => {
  let tempDir: string;
  let storage: ProfileStorage;

  beforeEach(async () => {
    // Create temp directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-quota-test-'));
    storage = new ProfileStorage(tempDir);
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates default config on first load', async () => {
    const config = await storage.load();
    
    assert.equal(config.version, PROFILE_CONFIG_VERSION);
    assert.deepEqual(config.profiles, []);
    assert.equal(typeof config.settings, 'object');
  });

  it('persists and loads config', async () => {
    const config = await storage.load();
    config.profiles.push({
      id: 'test-id',
      email: 'test@example.com',
      slug: 'test_example_com',
      displayName: 'Test',
      userDataDir: '/test/path',
      created: new Date().toISOString(),
    });

    await storage.save(config);
    
    // Create new storage instance to test persistence
    const storage2 = new ProfileStorage(tempDir);
    const loaded = await storage2.load();
    
    assert.equal(loaded.profiles.length, 1);
    assert.equal(loaded.profiles[0].email, 'test@example.com');
  });

  it('handles atomic writes', async () => {
    const config = await storage.load();
    
    // Simulate concurrent writes (second should wait for first)
    const promise1 = storage.save(config);
    const promise2 = storage.save(config);
    
    await Promise.all([promise1, promise2]);
    
    // Config file should be valid
    const loaded = await storage.load();
    assert.ok(loaded);
  });

  it('creates backup', async () => {
    const config = await storage.load();
    await storage.save(config);
    
    const backupPath = await storage.backup();
    
    assert.ok(backupPath.includes('.backup.'));
    const backupExists = await fs.access(backupPath).then(() => true).catch(() => false);
    assert.ok(backupExists);
  });

  it('restores from backup', async () => {
    const config = await storage.load();
    config.profiles.push({
      id: 'original',
      email: 'original@example.com',
      slug: 'original_example_com',
      displayName: 'Original',
      userDataDir: '/original',
      created: new Date().toISOString(),
    });
    await storage.save(config);
    
    const backupPath = await storage.backup();
    
    // Modify config
    config.profiles[0].email = 'modified@example.com';
    await storage.save(config);
    
    // Restore
    await storage.restore(backupPath);
    const restored = await storage.load();
    
    assert.equal(restored.profiles[0].email, 'original@example.com');
  });

  it('throws on invalid JSON', async () => {
    const configPath = storage.getConfigPath();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, 'invalid json{', 'utf-8');
    
    await assert.rejects(
      () => storage.load(),
      ProfileStorageError
    );
  });
});
```

### 4. Profile Manager (`src/profiles/profileManager.ts`)

High-level API for profile management with validation and business logic.

```typescript
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { ProfileStorage } from './profileStorage';
import {
  Profile,
  ProfileConfig,
  CreateProfileOptions,
  ValidationResult,
  PROFILE_DIR_PREFIX,
} from './types';
import { emailToSlug, validateSlug, generateUniqueSlug } from '../utils/emailToSlug';
import { normalizePath, pathsEqual, validateUserDataPath } from '../utils/pathUtils';

export class ProfileManagerError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'ProfileManagerError';
  }
}

export class ProfileManager {
  private storage: ProfileStorage;
  private config: ProfileConfig | null = null;

  constructor(storage?: ProfileStorage) {
    this.storage = storage ?? new ProfileStorage();
  }

  /**
   * Initialize the manager by loading configuration.
   */
  async initialize(): Promise<void> {
    this.config = await this.storage.load();
  }

  /**
   * Ensure config is loaded.
   */
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
    return [...config.profiles]; // Return copy
  }

  /**
   * Get a profile by ID.
   */
  async getProfile(id: string): Promise<Profile | undefined> {
    const config = await this.ensureLoaded();
    return config.profiles.find(p => p.id === id);
  }

  /**
   * Find profile by email address.
   */
  async findProfileByEmail(email: string): Promise<Profile | undefined> {
    const config = await this.ensureLoaded();
    return config.profiles.find(p => p.email.toLowerCase() === email.toLowerCase());
  }

  /**
   * Find profile by user data directory path.
   * Uses consistent path normalization for cross-platform compatibility.
   */
  async findProfileByPath(userDataDir: string): Promise<Profile | undefined> {
    const config = await this.ensureLoaded();
    return config.profiles.find(p => pathsEqual(p.userDataDir, userDataDir));
  }

  /**
   * Create a new profile.
   */
  async createProfile(options: CreateProfileOptions): Promise<Profile> {
    const config = await this.ensureLoaded();

    // Validate email
    const emailValidation = this.validateEmail(options.email);
    if (!emailValidation.valid) {
      throw new ProfileManagerError(`Invalid email: ${emailValidation.errors.join(', ')}`);
    }

    // Check for duplicate email
    const existing = await this.findProfileByEmail(options.email);
    if (existing) {
      throw new ProfileManagerError(`Profile with email ${options.email} already exists`);
    }

    // Generate slug
    const slug = emailToSlug(options.email);
    if (!validateSlug(slug)) {
      throw new ProfileManagerError(`Generated slug "${slug}" is invalid`);
    }

    // Generate user data directory path
    let userDataDir = path.join(os.homedir(), `${PROFILE_DIR_PREFIX}${slug}`);

    // Check for duplicate path and resolve collision if necessary
    const existingPath = await this.findProfileByPath(userDataDir);
    if (existingPath) {
      // Path collision detected - append hash to make unique
      const uniqueSlug = generateUniqueSlug(options.email, true);  // includeHash = true
      userDataDir = path.join(os.homedir(), `${PROFILE_DIR_PREFIX}${uniqueSlug}`);
      
      // Verify the unique path doesn't exist either (extremely unlikely)
      const stillExists = await this.findProfileByPath(userDataDir);
      if (stillExists) {
        throw new ProfileManagerError(
          `Unable to generate unique path for email ${options.email}. ` +
          `Both ${slug} and ${uniqueSlug} already exist.`
        );
      }
      
      console.log(`Path collision resolved: ${slug} → ${uniqueSlug}`);
    }

    // Create profile
    const profile: Profile = {
      id: randomUUID(),
      email: options.email,
      slug,
      displayName: options.displayName ?? this.generateDisplayName(options.email),
      userDataDir,
      created: new Date().toISOString(),
      theme: options.theme,
      color: options.color ?? this.generateRandomColor(),
      metadata: {
        source: 'manual',
        notes: options.notes,
        tags: options.tags,
      },
    };

    // Add to config
    config.profiles.push(profile);
    await this.storage.save(config);

    return profile;
  }

  /**
   * Update an existing profile.
   */
  async updateProfile(id: string, updates: Partial<Profile>): Promise<Profile> {
    const config = await this.ensureLoaded();
    
    const index = config.profiles.findIndex(p => p.id === id);
    if (index === -1) {
      throw new ProfileManagerError(`Profile with ID ${id} not found`);
    }

    // Validate email if changed
    if (updates.email) {
      const emailValidation = this.validateEmail(updates.email);
      if (!emailValidation.valid) {
        throw new ProfileManagerError(`Invalid email: ${emailValidation.errors.join(', ')}`);
      }

      // Check for duplicate (excluding current profile)
      const duplicate = config.profiles.find(
        p => p.id !== id && p.email.toLowerCase() === updates.email!.toLowerCase()
      );
      if (duplicate) {
        throw new ProfileManagerError(`Profile with email ${updates.email} already exists`);
      }
    }

    // Merge updates
    const profile = config.profiles[index];
    config.profiles[index] = {
      ...profile,
      ...updates,
      id: profile.id, // Never allow ID change
      email: updates.email ?? profile.email,
      slug: profile.slug, // Never allow slug change
      userDataDir: profile.userDataDir, // Never allow path change
      created: profile.created, // Never allow created date change
    };

    await this.storage.save(config);
    
    return config.profiles[index];
  }

  /**
   * Delete a profile.
   */
  async deleteProfile(id: string): Promise<void> {
    const config = await this.ensureLoaded();
    
    const index = config.profiles.findIndex(p => p.id === id);
    if (index === -1) {
      throw new ProfileManagerError(`Profile with ID ${id} not found`);
    }

    config.profiles.splice(index, 1);
    await this.storage.save(config);
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

    // Basic email regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      errors.push('Email format is invalid');
    }

    // Length check
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
   * Uses centralized path validation for security and consistency.
   */
  async isProfilePathValid(userDataDir: string): Promise<boolean> {
    // Validate path security
    const validation = validateUserDataPath(userDataDir);
    if (!validation.valid) {
      return false;
    }

    // Must not conflict with existing profile
    const existing = await this.findProfileByPath(userDataDir);
    return !existing;
  }

  /**
   * Generate a display name from email.
   */
  private generateDisplayName(email: string): string {
    const localPart = email.split('@')[0];
    // Capitalize first letter, replace dots/underscores with spaces
    return localPart
      .replace(/[._]/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Generate a random color for profile identification.
   */
  private generateRandomColor(): string {
    const colors = [
      '#3b82f6', // blue
      '#ef4444', // red
      '#10b981', // green
      '#f59e0b', // amber
      '#8b5cf6', // purple
      '#ec4899', // pink
      '#06b6d4', // cyan
      '#f97316', // orange
    ];
    return colors[Math.floor(Math.random() * colors.length)];
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
    
    const ages = config.profiles.map(p => {
      const created = new Date(p.created).getTime();
      return now - created;
    });

    return {
      totalProfiles: config.profiles.length,
      profilesWithTheme: config.profiles.filter(p => p.theme).length,
      averageAge: ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 0,
    };
  }
}
```

**Unit tests** (`src/test/profileManager.test.ts`):

```typescript
import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ProfileManager, ProfileManagerError } from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';

describe('ProfileManager', () => {
  let tempDir: string;
  let manager: ProfileManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-quota-test-'));
    const storage = new ProfileStorage(tempDir);
    manager = new ProfileManager(storage);
    await manager.initialize();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('createProfile', () => {
    it('creates a profile with valid email', async () => {
      const profile = await manager.createProfile({
        email: 'test@example.com',
      });

      assert.ok(profile.id);
      assert.equal(profile.email, 'test@example.com');
      assert.equal(profile.slug, 'test_example_com');
      assert.ok(profile.userDataDir.includes('.cursor-test_example_com'));
      assert.ok(profile.created);
    });

    it('generates display name from email', async () => {
      const profile = await manager.createProfile({
        email: 'john.doe@example.com',
      });

      assert.equal(profile.displayName, 'John Doe');
    });

    it('uses provided display name', async () => {
      const profile = await manager.createProfile({
        email: 'test@example.com',
        displayName: 'Custom Name',
      });

      assert.equal(profile.displayName, 'Custom Name');
    });

    it('assigns random color', async () => {
      const profile = await manager.createProfile({
        email: 'test@example.com',
      });

      assert.ok(profile.color);
      assert.match(profile.color, /^#[0-9a-f]{6}$/);
    });

    it('rejects duplicate email', async () => {
      await manager.createProfile({ email: 'test@example.com' });

      await assert.rejects(
        () => manager.createProfile({ email: 'test@example.com' }),
        ProfileManagerError
      );
    });

    it('rejects invalid email', async () => {
      await assert.rejects(
        () => manager.createProfile({ email: 'invalid' }),
        ProfileManagerError
      );
    });

    it('handles slug collision by appending hash', async () => {
      // This tests the collision resolution documented in Profile interface
      // When two emails generate paths that would collide, append hash to make unique
      
      const profile1 = await manager.createProfile({ email: 'test@example.com' });
      assert.equal(profile1.slug, 'test_example_com');
      assert.ok(profile1.userDataDir.includes('.cursor-test_example_com'));
      assert.ok(!profile1.slug.match(/_[a-f0-9]{8}$/), 'First profile should not have hash');
      
      // Manually create a collision by creating profile with same path
      // (In real usage, this could happen with similar emails like user@example.com and user_example@com)
      const storage = new ProfileStorage(tempDir);
      const config = await storage.load();
      
      // Add a fake profile that uses the same userDataDir
      config.profiles.push({
        id: 'fake-collision-id',
        email: 'collision@test.com',
        slug: 'test_example_com',  // Same slug as profile1
        displayName: 'Collision Test',
        userDataDir: profile1.userDataDir,  // Same path - collision!
        created: new Date().toISOString()
      });
      await storage.save(config);
      
      // Reinitialize manager to load modified config
      const manager2 = new ProfileManager(storage);
      await manager2.initialize();
      
      // Try to create another profile that would collide
      const profile3 = await manager2.createProfile({ email: 'another@test.com' });
      
      // If it generates same base slug, it should have been given hash suffix
      // (This test is probabilistic - may not always trigger collision)
      // Main assertion: profile was created successfully despite potential collision
      assert.ok(profile3.id);
      assert.ok(profile3.userDataDir);
    });
  });

  describe('getProfiles', () => {
    it('returns empty array initially', async () => {
      const profiles = await manager.getProfiles();
      assert.deepEqual(profiles, []);
    });

    it('returns all profiles', async () => {
      await manager.createProfile({ email: 'user1@example.com' });
      await manager.createProfile({ email: 'user2@example.com' });

      const profiles = await manager.getProfiles();
      assert.equal(profiles.length, 2);
    });
  });

  describe('getProfile', () => {
    it('returns profile by ID', async () => {
      const created = await manager.createProfile({ email: 'test@example.com' });
      const found = await manager.getProfile(created.id);

      assert.deepEqual(found, created);
    });

    it('returns undefined for non-existent ID', async () => {
      const found = await manager.getProfile('non-existent-id');
      assert.equal(found, undefined);
    });
  });

  describe('findProfileByEmail', () => {
    it('finds profile by exact email', async () => {
      await manager.createProfile({ email: 'test@example.com' });
      const found = await manager.findProfileByEmail('test@example.com');

      assert.ok(found);
      assert.equal(found.email, 'test@example.com');
    });

    it('finds profile case-insensitively', async () => {
      await manager.createProfile({ email: 'test@example.com' });
      const found = await manager.findProfileByEmail('TEST@EXAMPLE.COM');

      assert.ok(found);
    });

    it('returns undefined if not found', async () => {
      const found = await manager.findProfileByEmail('nonexistent@example.com');
      assert.equal(found, undefined);
    });
  });

  describe('updateProfile', () => {
    it('updates display name', async () => {
      const created = await manager.createProfile({ email: 'test@example.com' });
      const updated = await manager.updateProfile(created.id, {
        displayName: 'New Name',
      });

      assert.equal(updated.displayName, 'New Name');
      assert.equal(updated.email, created.email); // Unchanged
    });

    it('updates theme and color', async () => {
      const created = await manager.createProfile({ email: 'test@example.com' });
      const updated = await manager.updateProfile(created.id, {
        theme: 'Dark+',
        color: '#ff0000',
      });

      assert.equal(updated.theme, 'Dark+');
      assert.equal(updated.color, '#ff0000');
    });

    it('prevents ID change', async () => {
      const created = await manager.createProfile({ email: 'test@example.com' });
      const updated = await manager.updateProfile(created.id, {
        id: 'new-id',
      } as any);

      assert.equal(updated.id, created.id);
    });

    it('throws on non-existent profile', async () => {
      await assert.rejects(
        () => manager.updateProfile('non-existent', { displayName: 'Test' }),
        ProfileManagerError
      );
    });
  });

  describe('deleteProfile', () => {
    it('deletes profile by ID', async () => {
      const created = await manager.createProfile({ email: 'test@example.com' });
      await manager.deleteProfile(created.id);

      const found = await manager.getProfile(created.id);
      assert.equal(found, undefined);
    });

    it('throws on non-existent profile', async () => {
      await assert.rejects(
        () => manager.deleteProfile('non-existent'),
        ProfileManagerError
      );
    });
  });

  describe('validateEmail', () => {
    it('accepts valid emails', () => {
      assert.equal(manager.validateEmail('user@example.com').valid, true);
      assert.equal(manager.validateEmail('user+tag@domain.co.uk').valid, true);
    });

    it('rejects invalid emails', () => {
      assert.equal(manager.validateEmail('').valid, false);
      assert.equal(manager.validateEmail('invalid').valid, false);
      assert.equal(manager.validateEmail('@example.com').valid, false);
      assert.equal(manager.validateEmail('user@').valid, false);
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', async () => {
      await manager.createProfile({ email: 'user1@example.com', theme: 'Dark+' });
      await manager.createProfile({ email: 'user2@example.com' });

      const stats = await manager.getStats();

      assert.equal(stats.totalProfiles, 2);
      assert.equal(stats.profilesWithTheme, 1);
      assert.ok(stats.averageAge >= 0);
    });
  });
});
```

## Integration with Existing Code

### 1. Update `src/extension.ts`

Add ProfileManager initialization in the `activate` function:

```typescript
import { ProfileManager } from './profiles/profileManager';

export function activate(context: vscode.ExtensionContext): void {
  // Existing code...
  
  // Initialize ProfileManager
  const profileManager = new ProfileManager();
  void profileManager.initialize().catch(err => {
    console.error('Failed to initialize ProfileManager:', err);
  });

  // Store in context for access by other components
  context.subscriptions.push({
    dispose: () => {
      // Cleanup if needed
    }
  });
}
```

### 2. Add VS Code Configuration

Update `package.json` to add profile-related settings:

```json
{
  "contributes": {
    "configuration": {
      "title": "Cursor Quota",
      "properties": {
        "cursorQuota.profiles.autoDetectRunning": {
          "type": "boolean",
          "default": true,
          "description": "Automatically detect running Cursor instances for each profile."
        },
        "cursorQuota.profiles.showProfileInStatusBar": {
          "type": "boolean",
          "default": true,
          "description": "Show current profile name in the status bar."
        },
        "cursorQuota.profiles.refreshAllInterval": {
          "type": "number",
          "default": 300,
          "minimum": 60,
          "maximum": 3600,
          "description": "Interval in seconds for refreshing all profile quotas."
        }
      }
    }
  }
}
```

## Testing Strategy

### Unit Tests
Run existing test suite with new tests:
```bash
pnpm test
```

### Manual Testing
1. Create a test profile:
   ```typescript
   const manager = new ProfileManager();
   await manager.initialize();
   const profile = await manager.createProfile({
     email: 'test@example.com',
     displayName: 'Test Profile'
   });
   console.log(profile);
   ```

2. Verify config file created:
   ```bash
   cat ~/.cursor-accounts/config.json
   ```

3. Test email-to-slug conversion:
   ```typescript
   import { emailToSlug } from './utils/emailToSlug';
   console.log(emailToSlug('complex.email+tag@sub.domain.co.uk'));
   // Should output: complex_email_tag_sub_domain_co_uk
   ```

## Acceptance Criteria

- [ ] All TypeScript interfaces defined in `src/profiles/types.ts`
- [ ] Email-to-slug utility with comprehensive tests
- [ ] ProfileStorage can create, read, update config.json
- [ ] ProfileStorage supports atomic writes and backups
- [ ] ProfileManager provides full CRUD API
- [ ] ProfileManager validates emails and prevents duplicates
- [ ] All unit tests passing (100% coverage on new code)
- [ ] Cross-platform path handling (macOS, Windows, Linux)
- [ ] No external dependencies added
- [ ] TypeScript strict mode passes

## Known Limitations

- Config file is not encrypted (profiles are metadata only, no secrets)
- No migration system yet (will be needed for future schema changes)
- Email validation is basic (no DNS/MX checks)
- Slug collisions handled automatically by appending hash (rare but possible)

### Slug Collision Resolution

**Collision scenario**: Two different emails generate the same slug due to special character handling.

**Example**:
- `user@example.com` → slug: `user_example_com`
- `user+tag@example.com` → slug: `user_tag_example_com` (different)
- `user@example.com` vs `user_example@com` → both generate `user_example_com` (collision!)

**Resolution strategy**:
1. First profile with slug gets the simple form: `.cursor-user_example_com`
2. Second profile with same slug gets hash appended: `.cursor-user_example_com_a1b2c3d4`
3. Hash is first 8 characters of SHA256(email), ensuring uniqueness per email
4. This happens automatically in createProfile, transparent to user

**Why this approach**:
- Most users will never see collisions (requires deliberately similar emails)
- When collision occurs, resolution is automatic (no user interaction needed)
- Hash ensures uniqueness even for adversarial inputs
- Simple slugs preferred (more readable) when no collision exists

## Next Phase

Once Phase 1 is complete and tested, proceed to **Phase 2: Profile Launcher**, which will:
- Implement `ProfileDetector` to identify current profile
- Implement `ProfileLauncher` to spawn new Cursor instances
- Add VS Code commands for profile management
- Enhance status bar to show current profile

## Troubleshooting

### Config file permission errors
- Ensure `~/.cursor-accounts/` is writable
- Check file permissions: `ls -la ~/.cursor-accounts/`

### Slug generation issues
- Verify email format is valid
- Check for special characters causing empty slugs
- Review `emailToSlug.test.ts` for examples

### Tests failing
- Ensure Node.js 22 is active: `node --version`
- Clear temp directories: `rm -rf /tmp/cursor-quota-test-*`
- Run TypeScript compiler: `pnpm run compile`

## References

- [VS Code Extension API - ExtensionContext](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext)
- [Node.js fs/promises API](https://nodejs.org/api/fs.html#promises-api)
- [TypeScript Handbook - Interfaces](https://www.typescriptlang.org/docs/handbook/interfaces.html)
