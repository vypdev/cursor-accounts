# Phase 2: Profile Launcher

## Overview

Phase 2 builds on the profile infrastructure from Phase 1 to add user-facing functionality: detecting which profile is currently active, launching new profiles in separate Cursor windows, and displaying profile information in the status bar. This phase introduces the first interactive elements users will see.

## Goals

- Implement `ProfileDetector` to identify current profile
- Implement `ProfileLauncher` to spawn new Cursor instances with `--user-data-dir`
- Add VS Code commands for profile operations
- Enhance status bar to show current profile name/email
- Handle edge cases (executable not found, permission errors, etc.)
- Support all platforms (macOS, Windows, Linux)

## Prerequisites

- Phase 1 completed and tested
- ProfileManager, ProfileStorage working correctly
- Understanding of Node.js `child_process` API
- VS Code Command API knowledge

## Files to Create

```
src/
├── profiles/
│   ├── profileDetector.ts        # NEW: Detect current profile
│   └── profileLauncher.ts        # NEW: Launch Cursor instances
├── commands/
│   └── profileCommands.ts        # NEW: VS Code command registrations
└── test/
    ├── profileDetector.test.ts   # NEW: Unit tests
    └── profileLauncher.test.ts   # NEW: Unit tests
```

## Files to Modify

```
src/
├── extension.ts                  # MODIFY: Register commands, initialize components
├── ui/statusBarManager.ts        # MODIFY: Add profile indicator
└── config.ts                     # MODIFY: Add profile-related settings
```

## Implementation Details

### 1. Profile Detector (`src/profiles/profileDetector.ts`)

Identify which profile the current VS Code/Cursor instance is using.

**Detection Strategy**: This class uses VS Code's `context.globalStorageUri` API as the primary method for detecting the current user data directory. This is more reliable than environment variables or process arguments because:

1. **Environment variables** may not be set or may be stale from parent processes
2. **Process.argv** in an extension context may not include the `--user-data-dir` flag
3. **VS Code API** directly reflects the actual storage location being used by the current instance

The detection falls back to environment variables and process.argv only if the VS Code API method fails, with appropriate warnings logged.

```typescript
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { ProfileManager } from './profileManager';
import { Profile } from './types';
import { pathsEqual } from '../utils/pathUtils';

export class ProfileDetectorError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'ProfileDetectorError';
  }
}

export class ProfileDetector {
  private currentProfile: Profile | null | undefined = undefined;

  constructor(
    private readonly profileManager: ProfileManager,
    private readonly context: vscode.ExtensionContext  // NEW: Required for reliable detection
  ) {}

  /**
   * Detect which profile the current instance is using.
   * Returns null if using default Cursor profile (no --user-data-dir).
   * Caches result after first call.
   */
  async detectCurrentProfile(): Promise<Profile | null> {
    if (this.currentProfile !== undefined) {
      return this.currentProfile;
    }

    try {
      const userDataDir = this.getCurrentUserDataDir();
      const defaultDir = this.getDefaultCursorUserDataDir();

      // If using default directory, no profile is active
      // CRITICAL: Use pathsEqual for cross-platform matching (handles Windows case-insensitivity)
      if (pathsEqual(userDataDir, defaultDir)) {
        this.currentProfile = null;
        return null;
      }

      // Try to find matching profile
      const profile = await this.profileManager.findProfileByPath(userDataDir);
      this.currentProfile = profile ?? null;
      
      return this.currentProfile;
    } catch (error) {
      throw new ProfileDetectorError(
        'Failed to detect current profile',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get the current user data directory from VS Code API.
   * 
   * IMPORTANT: This method uses VS Code's context.globalStorageUri to reliably
   * determine the actual user data directory being used by the current instance.
   * This is more reliable than parsing process.argv or environment variables.
   * 
   * Note: The ExtensionContext must be passed to the constructor for this to work.
   */
  getCurrentUserDataDir(): string {
    // PREFERRED METHOD: Use VS Code API to get the actual storage path
    // The globalStorageUri gives us the path within the user data directory,
    // so we need to navigate up to get the user data dir root
    // 
    // globalStorageUri typically points to:
    // <userDataDir>/User/globalStorage/<publisher>.<extension>
    // 
    // So we need to go up 3 levels to get <userDataDir>
    
    if (this.context && this.context.globalStorageUri) {
      try {
        const globalStoragePath = this.context.globalStorageUri.fsPath;
        // Navigate from: <userDataDir>/User/globalStorage/<extension-id>
        // Up to: <userDataDir>
        const userDataDir = path.dirname(path.dirname(path.dirname(globalStoragePath)));
        return path.normalize(userDataDir);
      } catch (error) {
        console.warn('Failed to derive user data dir from globalStorageUri:', error);
        // Fall through to fallback methods
      }
    }

    // FALLBACK METHOD 1: Try environment variable (may be stale)
    const envDir = process.env.VSCODE_USER_DATA_DIR;
    if (envDir) {
      console.warn('Using VSCODE_USER_DATA_DIR environment variable (may be unreliable)');
      return path.normalize(envDir);
    }

    // FALLBACK METHOD 2: Try process.argv (unreliable in extension context)
    const args = process.argv;
    const userDataDirIndex = args.findIndex(arg => arg === '--user-data-dir');
    if (userDataDirIndex !== -1 && userDataDirIndex < args.length - 1) {
      console.warn('Using process.argv for user data dir (may be unreliable)');
      return path.normalize(args[userDataDirIndex + 1]);
    }

    // FALLBACK METHOD 3: Use default location
    console.warn('Could not detect custom user data dir, using default location');
    return this.getDefaultCursorUserDataDir();
  }

  /**
   * Get default Cursor user data directory for current platform.
   * 
   * **Default Profile**: When Cursor is launched WITHOUT --user-data-dir flag,
   * it uses these platform-specific default locations:
   * 
   * - **macOS**: `~/Library/Application Support/Cursor`
   * - **Windows**: `%APPDATA%\Cursor` (typically `C:\Users\<username>\AppData\Roaming\Cursor`)
   * - **Linux**: `~/.config/Cursor`
   * 
   * This is where Cursor stores `state.vscdb`, settings, extensions, etc.
   * when not using a custom profile.
   */
  getDefaultCursorUserDataDir(): string {
    const home = os.homedir();

    switch (process.platform) {
      case 'darwin':
        return path.join(home, 'Library', 'Application Support', 'Cursor');
      case 'win32':
        return path.join(
          process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
          'Cursor'
        );
      default: // linux
        return path.join(home, '.config', 'Cursor');
    }
  }

  /**
   * Check if current instance is using default profile.
   */
  isDefaultProfile(): boolean {
    const userDataDir = this.getCurrentUserDataDir();
    const defaultDir = this.getDefaultCursorUserDataDir();
    // Use centralized path comparison for consistent cross-platform behavior
    return pathsEqual(userDataDir, defaultDir);
  }

  /**
   * Clear cached profile (force re-detection).
   */
  clearCache(): void {
    this.currentProfile = undefined;
  }

  /**
   * Get a human-readable description of the current profile status.
   */
  async getProfileDescription(): Promise<string> {
    const profile = await this.detectCurrentProfile();
    
    if (!profile) {
      return 'Default Profile';
    }
    
    return profile.displayName;
  }
}
```

**Unit tests** (`src/test/profileDetector.test.ts`):

```typescript
import { strict as assert } from 'assert';
import * as path from 'path';
import * as os from 'os';
import { ProfileDetector, ProfileDetectorError } from '../profiles/profileDetector';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';

describe('ProfileDetector', () => {
  let manager: ProfileManager;
  let detector: ProfileDetector;

  beforeEach(async () => {
    const storage = new ProfileStorage(path.join(os.tmpdir(), 'test-config'));
    manager = new ProfileManager(storage);
    await manager.initialize();
    
    // Create mock context for testing
    const mockContext = {
      globalStorageUri: {
        fsPath: path.join(os.tmpdir(), 'test-user-data', 'User', 'globalStorage', 'test.extension')
      }
    } as vscode.ExtensionContext;
    
    detector = new ProfileDetector(manager, mockContext);
  });

  describe('getDefaultCursorUserDataDir', () => {
    it('returns platform-specific default path', () => {
      const defaultDir = detector.getDefaultCursorUserDataDir();
      
      assert.ok(defaultDir);
      assert.ok(path.isAbsolute(defaultDir));
      
      // Should contain 'Cursor'
      assert.ok(defaultDir.includes('Cursor'));
    });
  });

  describe('getCurrentUserDataDir', () => {
    it('returns a valid absolute path', () => {
      const userDataDir = detector.getCurrentUserDataDir();
      
      assert.ok(userDataDir);
      assert.ok(path.isAbsolute(userDataDir));
    });
  });

  describe('isDefaultProfile', () => {
    it('returns boolean', () => {
      const isDefault = detector.isDefaultProfile();
      assert.equal(typeof isDefault, 'boolean');
    });
  });

  describe('detectCurrentProfile', () => {
    it('caches result after first call', async () => {
      const profile1 = await detector.detectCurrentProfile();
      const profile2 = await detector.detectCurrentProfile();
      
      assert.deepEqual(profile1, profile2);
    });

    it('can clear cache', async () => {
      await detector.detectCurrentProfile();
      detector.clearCache();
      
      const profile = await detector.detectCurrentProfile();
      // Should re-detect (no error)
      assert.ok(true);
    });
  });

  describe('getProfileDescription', () => {
    it('returns description string', async () => {
      const description = await detector.getProfileDescription();
      
      assert.ok(description);
      assert.equal(typeof description, 'string');
    });
  });

  describe('cross-platform path matching', () => {
    it('handles Windows case-insensitivity correctly', async () => {
      // This test verifies the fix for Blocking Issue #1.1
      // Path comparison must use centralized pathsEqual() from pathUtils
      
      if (process.platform !== 'win32') {
        // Skip on non-Windows platforms
        return;
      }
      
      // Create profile with lowercase path
      const profile = await manager.createProfile({
        email: 'test@example.com',
        displayName: 'Test'
      });
      
      // Manually set user data dir to uppercase version (simulates Windows behavior)
      const uppercasePath = profile.userDataDir.toUpperCase();
      
      // Detection should match despite case difference
      // This would fail if using simple path.normalize() instead of pathsEqual()
      const detected = await manager.findProfileByPath(uppercasePath);
      
      assert.ok(detected, 'Should detect profile with case-insensitive path match');
      assert.equal(detected.id, profile.id);
    });
  });
});
```

### 2. Profile Launcher (`src/profiles/profileLauncher.ts`)

Launch new Cursor instances with specific profiles.

> **⚠️ SAFETY WARNING**: Phase 2 implementation does NOT prevent launching duplicate profile instances. The `checkIfRunning()` method is a stub that always returns `false`. This can cause data corruption if a profile is launched multiple times. **Phase 5 adds proper instance detection.** Do not deploy Phase 2 in production without Phase 5, or accept the risk of data corruption from concurrent profile usage.

```typescript
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { ProfileManager } from './profileManager';
import { Profile } from './types';

export interface LaunchResult {
  success: boolean;
  pid?: number;
  error?: string;
}

export class ProfileLauncherError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'ProfileLauncherError';
  }
}

export class ProfileLauncher {
  constructor(private readonly profileManager: ProfileManager) {}

  /**
   * Launch Cursor with the specified profile.
   */
  async launch(profileId: string): Promise<LaunchResult> {
    try {
      const profile = await this.profileManager.getProfile(profileId);
      if (!profile) {
        return {
          success: false,
          error: `Profile with ID ${profileId} not found`,
        };
      }

      // TODO(Phase 5): This check is placeholder until InstanceDetector available
      // Currently always returns false - Phase 5 will implement actual detection
      const alreadyRunning = await this.checkIfRunning(profileId);
      if (alreadyRunning) {
        return {
          success: false,
          error: `Profile "${profile.displayName}" may already be running. Close existing window first.`,
        };
      }

      return await this.launchWithProfile(profile);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Launch Cursor with a custom user-data-dir path.
   */
  async launchWithPath(userDataDir: string): Promise<LaunchResult> {
    try {
      const execPath = this.getExecutablePath();
      const args = this.buildLaunchArgs(userDataDir);
      
      const process = await this.spawnProcess(execPath, args);
      
      // Update last launched timestamp
      const profile = await this.profileManager.findProfileByPath(userDataDir);
      if (profile) {
        await this.profileManager.updateProfile(profile.id, {
          lastLaunched: new Date().toISOString(),
        });
      }

      return {
        success: true,
        pid: process.pid,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get Cursor executable path for current platform.
   */
  getExecutablePath(): string {
    switch (process.platform) {
      case 'darwin':
        return '/Applications/Cursor.app/Contents/MacOS/Cursor';
      case 'win32':
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
          return path.join(localAppData, 'Programs', 'Cursor', 'Cursor.exe');
        }
        throw new ProfileLauncherError('LOCALAPPDATA environment variable not set');
      default: // linux
        // Try common locations
        const possiblePaths = [
          '/usr/bin/cursor',
          '/usr/local/bin/cursor',
          path.join(process.env.HOME ?? '', '.local', 'bin', 'cursor'),
        ];
        // Return first path (actual existence check happens in spawnProcess)
        return possiblePaths[0];
    }
  }

  /**
   * Build command line arguments for launching with profile.
   */
  buildLaunchArgs(userDataDir: string): string[] {
    // Common args for all platforms
    return ['--user-data-dir', userDataDir];
  }

  /**
   * Build complete launch command for a profile.
   */
  buildLaunchCommand(profile: Profile): string[] {
    const execPath = this.getExecutablePath();
    const args = this.buildLaunchArgs(profile.userDataDir);
    return [execPath, ...args];
  }

  /**
   * Launch Cursor with a profile object.
   */
  private async launchWithProfile(profile: Profile): Promise<LaunchResult> {
    return await this.launchWithPath(profile.userDataDir);
  }

  /**
   * Check if profile is already running (STUB for Phase 5).
   * 
   * **IMPORTANT**: This is a placeholder implementation that always returns false.
   * Phase 5 will implement actual instance detection via InstanceDetector.
   * Until Phase 5, this provides the API contract but no actual protection.
   * 
   * @param profileId Profile ID to check
   * @returns Always false in Phase 2 (no detection)
   */
  private async checkIfRunning(profileId: string): Promise<boolean> {
    // TODO(Phase 5): Replace with actual instance detection
    // Phase 5 will inject InstanceDetector and call:
    // return await this.instanceDetector?.isProfileRunning(profileId) ?? false;
    return false;
  }

  /**
   * Spawn Cursor process (platform-specific implementation).
   */
  private async spawnProcess(
    execPath: string,
    args: string[]
  ): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      try {
        let process: ChildProcess;

        if (process.platform === 'darwin') {
          // macOS: Use 'open' command to properly launch app
          process = spawn('open', ['-na', execPath, '--args', ...args], {
            detached: true,
            stdio: 'ignore',
          });
        } else if (process.platform === 'win32') {
          // Windows: Direct spawn
          process = spawn(execPath, args, {
            detached: true,
            stdio: 'ignore',
            shell: true,
          });
        } else {
          // Linux: Direct spawn
          process = spawn(execPath, args, {
            detached: true,
            stdio: 'ignore',
          });
        }

        // Unref to allow parent to exit independently
        process.unref();

        // Wait a bit to check for immediate errors
        setTimeout(() => {
          if (process.killed || process.exitCode !== null) {
            reject(new ProfileLauncherError('Process failed to start'));
          } else {
            resolve(process);
          }
        }, 500);

      } catch (error) {
        reject(new ProfileLauncherError(
          'Failed to spawn process',
          error instanceof Error ? error : undefined
        ));
      }
    });
  }

  /**
   * Check if Cursor executable exists and is accessible.
   */
  async validateExecutable(): Promise<{ valid: boolean; error?: string }> {
    try {
      const execPath = this.getExecutablePath();
      const fs = await import('fs/promises');
      
      await fs.access(execPath);
      
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: 'Cursor executable not found. Please ensure Cursor is installed.',
      };
    }
  }
}
```

**Unit tests** (`src/test/profileLauncher.test.ts`):

```typescript
import { strict as assert } from 'assert';
import * as path from 'path';
import { ProfileLauncher } from '../profiles/profileLauncher';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';

describe('ProfileLauncher', () => {
  let manager: ProfileManager;
  let launcher: ProfileLauncher;

  beforeEach(async () => {
    const storage = new ProfileStorage(path.join(process.cwd(), 'test-config'));
    manager = new ProfileManager(storage);
    await manager.initialize();
    launcher = new ProfileLauncher(manager);
  });

  describe('getExecutablePath', () => {
    it('returns platform-specific executable path', () => {
      const execPath = launcher.getExecutablePath();
      
      assert.ok(execPath);
      assert.ok(path.isAbsolute(execPath));
      
      // Should contain 'Cursor'
      assert.ok(execPath.includes('Cursor'));
    });

    it('returns correct path for macOS', () => {
      if (process.platform === 'darwin') {
        const execPath = launcher.getExecutablePath();
        assert.equal(execPath, '/Applications/Cursor.app/Contents/MacOS/Cursor');
      }
    });
  });

  describe('buildLaunchArgs', () => {
    it('includes user-data-dir flag', () => {
      const args = launcher.buildLaunchArgs('/test/path');
      
      assert.ok(args.includes('--user-data-dir'));
      assert.ok(args.includes('/test/path'));
    });
  });

  describe('buildLaunchCommand', () => {
    it('builds complete command array', async () => {
      const profile = await manager.createProfile({
        email: 'test@example.com',
      });

      const command = launcher.buildLaunchCommand(profile);
      
      assert.ok(Array.isArray(command));
      assert.ok(command.length > 0);
      assert.ok(command.some(arg => arg.includes('--user-data-dir')));
    });
  });

  describe('validateExecutable', () => {
    it('returns validation result', async () => {
      const result = await launcher.validateExecutable();
      
      assert.ok(typeof result.valid === 'boolean');
      if (!result.valid) {
        assert.ok(result.error);
      }
    });
  });

  describe('launch', () => {
    it('returns error for non-existent profile', async () => {
      const result = await launcher.launch('non-existent-id');
      
      assert.equal(result.success, false);
      assert.ok(result.error);
    });

    // Note: Actual launch test requires Cursor to be installed
    // and is more suitable for integration testing
  });
});
```

### 3. Profile Commands (`src/commands/profileCommands.ts`)

Register VS Code commands for profile operations.

```typescript
import * as vscode from 'vscode';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileLauncher } from '../profiles/profileLauncher';
import { ProfileDetector } from '../profiles/profileDetector';

export function registerProfileCommands(
  context: vscode.ExtensionContext,
  profileManager: ProfileManager,
  profileLauncher: ProfileLauncher,
  profileDetector: ProfileDetector
): void {
  
  // Command: Add new profile
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorQuota.addProfile', async () => {
      try {
        const email = await vscode.window.showInputBox({
          prompt: 'Enter Cursor account email',
          placeHolder: 'user@example.com',
          validateInput: (value) => {
            const validation = profileManager.validateEmail(value);
            return validation.valid ? null : validation.errors.join(', ');
          },
        });

        if (!email) {
          return; // User cancelled
        }

        // Check for duplicate
        const existing = await profileManager.findProfileByEmail(email);
        if (existing) {
          vscode.window.showErrorMessage(
            `Profile with email ${email} already exists`
          );
          return;
        }

        const displayName = await vscode.window.showInputBox({
          prompt: 'Enter profile display name (optional)',
          placeHolder: 'e.g., Work, Personal, Client',
        });

        // Create profile
        const profile = await profileManager.createProfile({
          email,
          displayName,
        });

        // Ask if user wants to launch immediately
        const launch = await vscode.window.showInformationMessage(
          `Profile "${profile.displayName}" created. Launch now?`,
          'Launch',
          'Later'
        );

        if (launch === 'Launch') {
          const result = await profileLauncher.launch(profile.id);
          if (result.success) {
            vscode.window.showInformationMessage(
              `Launching ${profile.displayName}...`
            );
          } else {
            vscode.window.showErrorMessage(
              `Failed to launch profile: ${result.error}`
            );
          }
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to create profile: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    })
  );

  // Command: Launch profile
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorQuota.launchProfile', async () => {
      try {
        const profiles = await profileManager.getProfiles();

        if (profiles.length === 0) {
          const create = await vscode.window.showInformationMessage(
            'No profiles configured. Create one now?',
            'Create Profile'
          );
          if (create) {
            await vscode.commands.executeCommand('cursorQuota.addProfile');
          }
          return;
        }

        // Show quick pick
        const selected = await vscode.window.showQuickPick(
          profiles.map(p => ({
            label: p.displayName,
            description: p.email,
            detail: `Last launched: ${p.lastLaunched ? new Date(p.lastLaunched).toLocaleString() : 'Never'}`,
            profile: p,
          })),
          {
            placeHolder: 'Select profile to launch',
          }
        );

        if (!selected) {
          return; // User cancelled
        }

        // Validate executable before launching
        const validation = await profileLauncher.validateExecutable();
        if (!validation.valid) {
          vscode.window.showErrorMessage(validation.error ?? 'Cursor executable not found');
          return;
        }

        // Launch
        const result = await profileLauncher.launch(selected.profile.id);
        
        if (result.success) {
          vscode.window.showInformationMessage(
            `Launching ${selected.profile.displayName}...`
          );
        } else {
          vscode.window.showErrorMessage(
            `Failed to launch profile: ${result.error}`
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to launch profile: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    })
  );

  // Command: List profiles
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorQuota.listProfiles', async () => {
      try {
        const profiles = await profileManager.getProfiles();
        const current = await profileDetector.detectCurrentProfile();

        if (profiles.length === 0) {
          vscode.window.showInformationMessage(
            'No profiles configured. Use "Cursor Quota: Add Profile" to create one.'
          );
          return;
        }

        // Show in output channel
        const output = vscode.window.createOutputChannel('Cursor Profiles');
        output.clear();
        output.appendLine('Configured Cursor Profiles:');
        output.appendLine('');

        for (const profile of profiles) {
          const isCurrent = current?.id === profile.id;
          output.appendLine(`${isCurrent ? '● ' : '○ '}${profile.displayName}`);
          output.appendLine(`  Email: ${profile.email}`);
          output.appendLine(`  Path: ${profile.userDataDir}`);
          if (profile.lastLaunched) {
            output.appendLine(`  Last launched: ${new Date(profile.lastLaunched).toLocaleString()}`);
          }
          output.appendLine('');
        }

        output.show();
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to list profiles: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    })
  );

  // Command: Delete profile
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorQuota.deleteProfile', async () => {
      try {
        const profiles = await profileManager.getProfiles();

        if (profiles.length === 0) {
          vscode.window.showInformationMessage('No profiles to delete.');
          return;
        }

        const selected = await vscode.window.showQuickPick(
          profiles.map(p => ({
            label: p.displayName,
            description: p.email,
            profile: p,
          })),
          {
            placeHolder: 'Select profile to delete',
          }
        );

        if (!selected) {
          return;
        }

        // Confirm deletion
        const confirm = await vscode.window.showWarningMessage(
          `Delete profile "${selected.profile.displayName}"? This will NOT delete the user data directory.`,
          { modal: true },
          'Delete'
        );

        if (confirm !== 'Delete') {
          return;
        }

        await profileManager.deleteProfile(selected.profile.id);
        
        vscode.window.showInformationMessage(
          `Profile "${selected.profile.displayName}" deleted.`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to delete profile: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    })
  );

  // Command: Show current profile
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorQuota.showCurrentProfile', async () => {
      try {
        const current = await profileDetector.detectCurrentProfile();

        if (!current) {
          vscode.window.showInformationMessage(
            'Using default Cursor profile (no custom profile active)'
          );
          return;
        }

        vscode.window.showInformationMessage(
          `Current profile: ${current.displayName} (${current.email})`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to detect current profile: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    })
  );
}
```

### 4. Status Bar Enhancement (`src/ui/statusBarManager.ts`)

Add profile indicator to status bar.

**Modifications**:

```typescript
// Add new imports
import { ProfileDetector } from '../profiles/profileDetector';

// Add new status bar item property
private readonly profileItem: vscode.StatusBarItem;

// In constructor, create profile item
constructor(
  private readonly context: vscode.ExtensionContext,
  private readonly profileDetector?: ProfileDetector  // NEW: Optional detector
) {
  // Existing items...
  
  // NEW: Profile indicator (highest priority)
  if (profileDetector) {
    this.profileItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      102  // Higher priority than quota items
    );
    this.profileItem.name = 'cursorQuota.profile';
    this.profileItem.command = 'cursorQuota.showCurrentProfile';
    this.profileItem.tooltip = 'Click to see current profile details';
    context.subscriptions.push(this.profileItem);
  }
}

// NEW: Method to update profile indicator
async updateProfileIndicator(): Promise<void> {
  if (!this.profileDetector || !this.profileItem) {
    return;
  }

  try {
    const profile = await this.profileDetector.detectCurrentProfile();
    const config = getCursorQuotaConfig();

    if (!config.showProfileInStatusBar) {
      this.profileItem.hide();
      return;
    }

    if (profile) {
      this.profileItem.text = `👤 ${profile.displayName}`;
      this.profileItem.tooltip = `Profile: ${profile.displayName}\nEmail: ${profile.email}\n\nClick for details`;
      this.profileItem.show();
    } else {
      // Default profile
      this.profileItem.text = `👤 Default`;
      this.profileItem.tooltip = 'Using default Cursor profile\n\nClick for details';
      this.profileItem.show();
    }
  } catch (error) {
    console.error('Failed to update profile indicator:', error);
    this.profileItem.hide();
  }
}

// Call updateProfileIndicator in showOnActivate
showOnActivate(): void {
  void this.updateProfileIndicator();  // NEW
  // Existing code...
}
```

### 5. Configuration Update (`src/config.ts`)

Add profile-related settings.

```typescript
export interface CursorQuotaConfig {
  // Existing fields...
  showProfileInStatusBar: boolean;  // NEW
}

export function getCursorQuotaConfig(): CursorQuotaConfig {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  return {
    // Existing fields...
    showProfileInStatusBar: cfg.get<boolean>('profiles.showProfileInStatusBar', true),
  };
}
```

### 6. Extension Activation (`src/extension.ts`)

Wire everything together in the activation function.

```typescript
import { ProfileManager } from './profiles/profileManager';
import { ProfileDetector } from './profiles/profileDetector';
import { ProfileLauncher } from './profiles/profileLauncher';
import { registerProfileCommands } from './commands/profileCommands';

export function activate(context: vscode.ExtensionContext): void {
  // Initialize profile management
  const profileManager = new ProfileManager();
  const profileDetector = new ProfileDetector(profileManager, context);  // Pass context for reliable detection
  const profileLauncher = new ProfileLauncher(profileManager);

  // Initialize async
  void profileManager.initialize().catch(err => {
    console.error('Failed to initialize ProfileManager:', err);
  });

  // Register profile commands
  registerProfileCommands(
    context,
    profileManager,
    profileLauncher,
    profileDetector
  );

  // Update status bar with profile detector
  const statusBar = new StatusBarManager(context, profileDetector);
  statusBar.showOnActivate();

  // Existing code...
}
```

### 7. Package.json Updates

Add new commands to `package.json`:

```json
{
  "contributes": {
    "commands": [
      {
        "command": "cursorQuota.addProfile",
        "title": "Cursor Quota: Add Profile",
        "icon": "$(add)"
      },
      {
        "command": "cursorQuota.launchProfile",
        "title": "Cursor Quota: Launch Profile",
        "icon": "$(rocket)"
      },
      {
        "command": "cursorQuota.listProfiles",
        "title": "Cursor Quota: List Profiles"
      },
      {
        "command": "cursorQuota.deleteProfile",
        "title": "Cursor Quota: Delete Profile",
        "icon": "$(trash)"
      },
      {
        "command": "cursorQuota.showCurrentProfile",
        "title": "Cursor Quota: Show Current Profile"
      }
    ],
    "configuration": {
      "properties": {
        "cursorQuota.profiles.showProfileInStatusBar": {
          "type": "boolean",
          "default": true,
          "description": "Show current profile name in the status bar."
        }
      }
    }
  }
}
```

## User Workflows

### Workflow 1: First-Time Profile Creation

1. User opens Command Palette (Cmd+Shift+P)
2. Types "Cursor Quota: Add Profile"
3. Enters email: `work@company.com`
4. Enters display name: `Work`
5. Extension creates profile and offers to launch
6. User clicks "Launch"
7. New Cursor window opens with Work profile

### Workflow 2: Switching Profiles

1. User currently in Personal profile window
2. Opens Command Palette
3. Types "Cursor Quota: Launch Profile"
4. Sees list: Personal, Work, Client
5. Selects "Work"
6. New window opens with Work profile
7. User can close Personal window if desired

### Workflow 3: Checking Current Profile

1. User looks at status bar
2. Sees `👤 Work` indicator
3. Clicks on it
4. Info message shows: "Current profile: Work (work@company.com)"

## Testing Strategy

### Unit Tests
```bash
pnpm test
```

### Integration Tests (REQUIRED)

**Profile Detection Integration Test**: Since profile detection relies on VS Code's runtime environment, integration testing is critical:

```typescript
// integration-tests/profileDetection.test.ts
describe('ProfileDetector Integration', () => {
  it('should detect profile from globalStorageUri in real extension context', async () => {
    // This test must run in Extension Development Host
    const context = vscode.extensions.getExtension('your.extension')?.extensionContext;
    assert.ok(context, 'Extension context required');
    
    const manager = new ProfileManager();
    await manager.initialize();
    
    const detector = new ProfileDetector(manager, context);
    const userDataDir = detector.getCurrentUserDataDir();
    
    // Verify it's an absolute path
    assert.ok(path.isAbsolute(userDataDir));
    
    // Verify it contains expected structure
    const hasUserDir = await fs.access(path.join(userDataDir, 'User'))
      .then(() => true)
      .catch(() => false);
    assert.ok(hasUserDir, 'User directory should exist in detected path');
  });
  
  it('should correctly detect custom profile vs default', async () => {
    // Test both cases:
    // 1. Launch with --user-data-dir (should detect custom profile)
    // 2. Launch without flag (should detect default profile)
    // These must be separate test runs with different launch args
  });
});
```

**Testing Checklist**:
- [ ] Test detection with default Cursor installation (no --user-data-dir)
- [ ] Test detection with custom --user-data-dir flag
- [ ] Test detection after creating and launching a profile
- [ ] Verify globalStorageUri path parsing on macOS, Windows, Linux
- [ ] Test fallback behavior when globalStorageUri is unavailable

### Manual Testing

1. **Profile Detection**:
   ```bash
   # Launch Cursor with custom user-data-dir
   /Applications/Cursor.app/Contents/MacOS/Cursor --user-data-dir=~/.cursor-test
   # Open extension, check if profile detected
   ```
   
   **Verification Steps**:
   - Run command "Cursor Quota: Show Current Profile"
   - Check status bar shows correct profile name
   - Verify detection works immediately on extension activation
   - Test that detection persists across window reloads

2. **Profile Launching**:
   - Create profile via command
   - Launch it
   - Verify new window opens
   - Check that both windows can run independently
   - Verify each window correctly detects its own profile

3. **Status Bar**:
   - Verify profile name shows in status bar
   - Click to see details
   - Try with default profile (no indicator)
   - Test that status bar updates when switching windows

4. **Cross-Platform**:
   - Test on macOS, Windows, Linux
   - Verify executable paths correct
   - Verify launch works on each platform
   - **CRITICAL**: Verify globalStorageUri parsing works on all platforms (path separators differ)

## Acceptance Criteria

- [ ] ProfileDetector correctly identifies current profile
- [ ] ProfileDetector handles default profile case
- [ ] ProfileDetector uses centralized `pathsEqual()` for cross-platform path matching
- [ ] ProfileLauncher can spawn new Cursor instances on all platforms
- [ ] ProfileLauncher includes `checkIfRunning()` stub (always returns false)
- [ ] **Launcher does NOT prevent duplicate profile launches** (Phase 5 requirement)
- [ ] All commands registered and functional
- [ ] Status bar shows current profile name
- [ ] Status bar respects showProfileInStatusBar config
- [ ] Commands handle errors gracefully (executable not found, etc.)
- [ ] Unit tests passing, including Windows path matching test
- [ ] No regressions in existing quota functionality

## Known Issues & Limitations

### Platform-Specific Behavior
- **macOS**: Uses `open -na` for proper app launching
- **Windows**: May show UAC prompt if Cursor installed in Program Files
- **Linux**: Requires Cursor in PATH or standard location

### Launch Timing
- Small delay (500ms) before confirming successful launch
- If Cursor takes longer to start, may report success prematurely

### Multiple Instances
- OS may limit number of simultaneous Cursor instances
- Memory usage scales linearly with number of open profiles

## Troubleshooting

### "Cursor executable not found"
- **macOS**: Ensure Cursor installed in `/Applications/`
- **Windows**: Check `%LOCALAPPDATA%\Programs\Cursor\`
- **Linux**: Add Cursor to PATH or install to standard location

### Profile not detected
- Check `--user-data-dir` in process args
- Verify path matches profile config
- Try `Cursor Quota: Show Current Profile` command

### Launch fails silently
- Check Console for error messages
- Verify user has permission to write to user-data-dir
- Try launching Cursor manually with same args

## Next Phase

Once Phase 2 is complete and tested, proceed to **Phase 3: Accounts Panel**, which will:
- Create webview sidebar with React UI
- Visual profile list with cards
- Add/edit/delete workflows in UI
- Integration with ProfileManager and ProfileLauncher

## References

- [VS Code Commands API](https://code.visualstudio.com/api/references/vscode-api#commands)
- [Node.js child_process](https://nodejs.org/api/child_process.html)
- [VS Code Status Bar](https://code.visualstudio.com/api/ux-guidelines/status-bar)
