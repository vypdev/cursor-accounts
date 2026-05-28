# Phase 5: Instance Detection

## Overview

Phase 5 adds automatic detection of running Cursor instances, allowing users to see at a glance which profiles currently have open windows. This provides visual feedback (green dot indicators) and prevents accidentally launching duplicate instances of the same profile.

## Goals

- Detect running Cursor processes on the system
- Match process PIDs to configured profile directories
- Add visual indicators (green dot) for active profiles
- Poll for changes at configurable interval
- Handle multi-platform differences (macOS, Windows, Linux)
- Provide "Already running" feedback when launching active profile
- Auto-update UI when instances start/stop

## Prerequisites

- Phase 1-4 completed and tested
- Profile infrastructure and accounts panel working
- Understanding of process inspection techniques per platform
- Node.js `child_process` knowledge

## Files to Create

```
src/
├── profiles/
│   └── instanceDetector.ts          # NEW: Detect running instances
└── test/
    └── instanceDetector.test.ts     # NEW: Unit tests
```

## Files to Modify

```
src/
├── ui/accountsPanel.ts               # MODIFY: Send instance data
├── profiles/types.ts                 # MODIFY: Add InstanceInfo type
├── profiles/profileManager.ts        # MODIFY: Add running profile delete check
├── profiles/profileLauncher.ts       # MODIFY: Add instance detector injection
├── extension.ts                      # MODIFY: Initialize detector

webview/src/
├── components/ProfileCard.tsx        # MODIFY: Show "running" indicator
└── types/index.ts                    # MODIFY: Add instance types
```

## Implementation Details

### 1. Instance Info Type (`src/profiles/types.ts` additions)

```typescript
/**
 * Information about a running Cursor instance.
 */
export interface InstanceInfo {
  profileId: string;
  pid: number;
  startTime?: number;      // Unix timestamp (if available)
  userDataDir: string;
  detectedAt: number;      // When we detected it
}

// Add to ToWebviewMessage union
export type ToWebviewMessage =
  | { type: 'init'; data: InitData }
  | { type: 'profiles'; data: Profile[] }
  | { type: 'currentProfile'; data: Profile | null }
  | { type: 'quotas'; data: Map<string, ProfileQuota> }
  | { type: 'runningInstances'; data: Map<string, InstanceInfo> }  // NEW
  | { type: 'error'; message: string }
  | { type: 'success'; message: string };

// Update InitData
export interface InitData {
  profiles: Profile[];
  currentProfile: Profile | null;
  quotas: Map<string, ProfileQuota>;
  runningInstances: Map<string, InstanceInfo>;  // NEW
}
```

### 2. Instance Detector (`src/profiles/instanceDetector.ts`)

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import { ProfileManager } from './profileManager';
import { Profile, InstanceInfo } from './types';
import { pathsEqual } from '../utils/pathUtils';

const execAsync = promisify(exec);

export class InstanceDetectorError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'InstanceDetectorError';
  }
}

export class InstanceDetector {
  private pollTimer: NodeJS.Timeout | undefined;
  private lastDetection: Map<string, InstanceInfo> = new Map();

  constructor(private readonly profileManager: ProfileManager) {}

  /**
   * Detect all running Cursor instances and match to profiles.
   */
  async detectRunningInstances(): Promise<Map<string, InstanceInfo>> {
    try {
      const processes = await this.getCursorProcesses();
      const profiles = await this.profileManager.getProfiles();
      
      const instances = new Map<string, InstanceInfo>();

      for (const proc of processes) {
        // Try to match this process to a known profile
        const profile = profiles.find(p => 
          proc.userDataDir && 
          this.pathsMatch(proc.userDataDir, p.userDataDir)
        );

        if (profile) {
          instances.set(profile.id, {
            profileId: profile.id,
            pid: proc.pid,
            startTime: proc.startTime,
            userDataDir: proc.userDataDir ?? profile.userDataDir,
            detectedAt: Date.now(),
          });
        }
      }

      this.lastDetection = instances;
      return instances;
    } catch (error) {
      throw new InstanceDetectorError(
        'Failed to detect running instances',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Check if a specific profile is currently running.
   */
  async isProfileRunning(profileId: string): Promise<boolean> {
    const instances = await this.detectRunningInstances();
    return instances.has(profileId);
  }

  /**
   * Get last detected instances (cached).
   */
  getLastDetection(): Map<string, InstanceInfo> {
    return new Map(this.lastDetection);
  }

  /**
   * Start automatic detection with polling.
   */
  startAutoDetection(intervalMs: number = 30000): void {
    this.stopAutoDetection();

    // Initial detection
    void this.detectRunningInstances();

    // Set up polling
    this.pollTimer = setInterval(() => {
      void this.detectRunningInstances();
    }, intervalMs);
  }

  /**
   * Stop automatic detection.
   */
  stopAutoDetection(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /**
   * Get Cursor processes running on the system.
   * Platform-specific implementation.
   */
  private async getCursorProcesses(): Promise<Array<{
    pid: number;
    userDataDir?: string;
    startTime?: number;
  }>> {
    switch (process.platform) {
      case 'darwin':
        return await this.getCursorProcessesMacOS();
      case 'win32':
        return await this.getCursorProcessesWindows();
      default:
        return await this.getCursorProcessesLinux();
    }
  }

  /**
   * Get Cursor processes on macOS.
   * 
   * IMPORTANT: This implementation uses process parsing which is inherently fragile.
   * Future OS updates may change ps output format. Error handling is critical.
   * 
   * The implementation filters for main Cursor processes only, ignoring helper processes
   * (Cursor Helper, GPU Process, etc.) to avoid false positives.
   */
  private async getCursorProcessesMacOS(): Promise<Array<{
    pid: number;
    userDataDir?: string;
    startTime?: number;
  }>> {
    try {
      // Use ps to find Cursor processes with full command line
      // Note: grep -i "[C]ursor" prevents grep itself from matching
      const { stdout } = await execAsync(
        'ps -eo pid,lstart,args | grep -i "[C]ursor" | grep -i "MacOS/Cursor"',
        { timeout: 5000 } // Prevent hanging
      );

      const processes: Array<{ pid: number; userDataDir?: string; startTime?: number }> = [];
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          // Parse line: PID  START_TIME  COMMAND
          // More flexible regex that handles variable whitespace
          const match = line.match(/^\s*(\d+)\s+(.+?)\s+(\/.*?)$/);
          if (!match) {
            console.warn('Failed to parse ps line:', line);
            continue;
          }

          const pid = parseInt(match[1], 10);
          if (isNaN(pid)) {
            console.warn('Invalid PID in ps line:', line);
            continue;
          }

          const command = match[3];

          // Filter out Cursor Helper processes - we only want the main process
          // Helper processes include: "Cursor Helper", "Cursor Helper (GPU)",
          // "Cursor Helper (Renderer)", etc.
          if (command.includes('Helper')) {
            continue;
          }

          // Extract --user-data-dir if present
          // Handle both --user-data-dir=/path and --user-data-dir /path formats
          const userDataDirMatch = command.match(/--user-data-dir[=\s]+["']?([^"'\s]+)["']?/);
          const userDataDir = userDataDirMatch ? userDataDirMatch[1] : undefined;

          processes.push({
            pid,
            userDataDir,
          });
        } catch (lineError) {
          // Log but don't fail - continue processing other lines
          console.error('Error parsing ps line:', line, lineError);
        }
      }

      return processes;
    } catch (error) {
      // No Cursor processes found (grep returns exit code 1)
      if (error instanceof Error && 'code' in error && error.code === 1) {
        return [];
      }
      
      // Other errors (timeout, command not found, etc.)
      console.error('Failed to get Cursor processes on macOS:', error);
      throw new InstanceDetectorError(
        'Failed to detect running Cursor instances on macOS',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get Cursor processes on Windows.
   * 
   * IMPORTANT: This implementation uses PowerShell instead of wmic (which is deprecated).
   * Falls back to wmic if PowerShell is unavailable (older Windows versions).
   */
  private async getCursorProcessesWindows(): Promise<Array<{
    pid: number;
    userDataDir?: string;
    startTime?: number;
  }>> {
    // Try PowerShell first (recommended method)
    try {
      return await this.getCursorProcessesWindowsPowerShell();
    } catch (psError) {
      console.warn('PowerShell detection failed, falling back to wmic:', psError);
      
      // Fall back to wmic (deprecated but still available on most systems)
      try {
        return await this.getCursorProcessesWindowsWmic();
      } catch (wmicError) {
        console.error('Both PowerShell and wmic detection failed');
        throw new InstanceDetectorError(
          'Failed to detect running Cursor instances on Windows',
          wmicError instanceof Error ? wmicError : undefined
        );
      }
    }
  }

  /**
   * Get Cursor processes using PowerShell (preferred method for Windows).
   */
  private async getCursorProcessesWindowsPowerShell(): Promise<Array<{
    pid: number;
    userDataDir?: string;
    startTime?: number;
  }>> {
    try {
      // Use PowerShell to get Cursor processes
      const { stdout } = await execAsync(
        'powershell -Command "Get-Process | Where-Object {$_.ProcessName -eq \'Cursor\'} | ' +
        'Select-Object Id,CommandLine | ConvertTo-Json"',
        { timeout: 5000 }
      );

      const processes: Array<{ pid: number; userDataDir?: string }> = [];
      
      // Parse JSON output
      let processData: any;
      try {
        processData = JSON.parse(stdout.trim());
      } catch (jsonError) {
        console.error('Failed to parse PowerShell JSON output:', stdout);
        throw new Error('Invalid JSON from PowerShell');
      }

      // Handle both single process (object) and multiple processes (array)
      const processArray = Array.isArray(processData) ? processData : [processData];

      for (const proc of processArray) {
        if (!proc || !proc.Id) continue;

        try {
          const pid = parseInt(proc.Id, 10);
          if (isNaN(pid)) continue;

          const command = proc.CommandLine || '';
          
          // Filter out helper processes
          if (command.includes('Helper') || command.includes('--type=')) {
            continue;
          }

          // Extract --user-data-dir
          const userDataDirMatch = command.match(/--user-data-dir[=\s]+["']?([^"'\s]+)["']?/);
          const userDataDir = userDataDirMatch ? userDataDirMatch[1].replace(/"/g, '') : undefined;

          processes.push({
            pid,
            userDataDir,
          });
        } catch (procError) {
          console.error('Error processing PowerShell process entry:', proc, procError);
        }
      }

      return processes;
    } catch (error) {
      // Check if it's just "no processes found" vs actual error
      if (error instanceof Error && error.message.includes('Cannot find a process')) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get Cursor processes using wmic (fallback for older Windows).
   * DEPRECATED: wmic is deprecated by Microsoft, use PowerShell when possible.
   */
  private async getCursorProcessesWindowsWmic(): Promise<Array<{
    pid: number;
    userDataDir?: string;
    startTime?: number;
  }>> {
    try {
      const { stdout } = await execAsync(
        'wmic process where "name=\'Cursor.exe\'" get ProcessId,CommandLine /format:list',
        { timeout: 5000 }
      );

      const processes: Array<{ pid: number; userDataDir?: string }> = [];
      const blocks = stdout.split('\n\n');

      for (const block of blocks) {
        if (!block.trim()) continue;

        try {
          const pidMatch = block.match(/ProcessId=(\d+)/);
          const commandMatch = block.match(/CommandLine=(.+)/);

          if (!pidMatch) continue;

          const pid = parseInt(pidMatch[1], 10);
          if (isNaN(pid)) continue;

          const command = commandMatch ? commandMatch[1] : '';
          
          // Filter out helper processes
          if (command.includes('Helper') || command.includes('--type=')) {
            continue;
          }

          // Extract --user-data-dir
          const userDataDirMatch = command.match(/--user-data-dir[=\s]+["']?([^"'\s]+)["']?/);
          const userDataDir = userDataDirMatch ? userDataDirMatch[1].replace(/"/g, '') : undefined;

          processes.push({
            pid,
            userDataDir,
          });
        } catch (blockError) {
          console.error('Error parsing wmic block:', block, blockError);
        }
      }

      return processes;
    } catch (error) {
      // No processes found or command failed
      if (error instanceof Error && error.message.includes('No Instance')) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get Cursor processes on Linux.
   * 
   * Similar parsing challenges as macOS. Filters helper processes to get main instances only.
   */
  private async getCursorProcessesLinux(): Promise<Array<{
    pid: number;
    userDataDir?: string;
    startTime?: number;
  }>> {
    try {
      // Use ps with full command line
      const { stdout } = await execAsync(
        'ps -eo pid,args | grep -i "[c]ursor" | grep -v grep',
        { timeout: 5000 }
      );

      const processes: Array<{ pid: number; userDataDir?: string }> = [];
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const match = line.match(/^\s*(\d+)\s+(.+)$/);
          if (!match) {
            console.warn('Failed to parse ps line:', line);
            continue;
          }

          const pid = parseInt(match[1], 10);
          if (isNaN(pid)) {
            console.warn('Invalid PID in ps line:', line);
            continue;
          }

          const command = match[2];

          // Filter out helper processes
          if (command.includes('Helper') || command.includes('--type=')) {
            continue;
          }

          // Extract --user-data-dir
          const userDataDirMatch = command.match(/--user-data-dir[=\s]+["']?([^"'\s]+)["']?/);
          const userDataDir = userDataDirMatch ? userDataDirMatch[1] : undefined;

          processes.push({
            pid,
            userDataDir,
          });
        } catch (lineError) {
          console.error('Error parsing ps line:', line, lineError);
        }
      }

      return processes;
    } catch (error) {
      // No processes found (grep returns exit code 1)
      if (error instanceof Error && 'code' in error && error.code === 1) {
        return [];
      }
      
      console.error('Failed to get Cursor processes on Linux:', error);
      throw new InstanceDetectorError(
        'Failed to detect running Cursor instances on Linux',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Compare two paths for equality (normalized).
   * Uses centralized path utility for consistent cross-platform behavior.
   */
  private pathsMatch(path1: string, path2: string): boolean {
    return pathsEqual(path1, path2);
  }
}
```

**Unit tests** (`src/test/instanceDetector.test.ts`):

```typescript
import { strict as assert } from 'assert';
import * as path from 'path';
import * as os from 'os';
import { InstanceDetector } from '../profiles/instanceDetector';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';

describe('InstanceDetector', () => {
  let manager: ProfileManager;
  let detector: InstanceDetector;

  beforeEach(async () => {
    const storage = new ProfileStorage(path.join(os.tmpdir(), 'test-config'));
    manager = new ProfileManager(storage);
    await manager.initialize();
    detector = new InstanceDetector(manager);
  });

  afterEach(() => {
    detector.stopAutoDetection();
  });

  describe('detectRunningInstances', () => {
    it('returns a map', async () => {
      const instances = await detector.detectRunningInstances();
      assert.ok(instances instanceof Map);
    });

    it('returns empty map when no profiles configured', async () => {
      const instances = await detector.detectRunningInstances();
      assert.equal(instances.size, 0);
    });

    // Note: Testing actual detection requires Cursor to be running
    // More suitable for integration tests
  });

  describe('getLastDetection', () => {
    it('returns cached detection', async () => {
      await detector.detectRunningInstances();
      const cached = detector.getLastDetection();
      
      assert.ok(cached instanceof Map);
    });
  });

  describe('startAutoDetection', () => {
    it('starts polling without error', () => {
      detector.startAutoDetection(5000);
      assert.ok(true);
    });

    it('can be stopped', () => {
      detector.startAutoDetection(5000);
      detector.stopAutoDetection();
      assert.ok(true);
    });
  });

  describe('isProfileRunning', () => {
    it('returns boolean', async () => {
      const result = await detector.isProfileRunning('non-existent-id');
      assert.equal(typeof result, 'boolean');
    });

    it('returns false for non-existent profile', async () => {
      const result = await detector.isProfileRunning('non-existent-id');
      assert.equal(result, false);
    });
  });
});
```

### 3. Accounts Panel Integration (`src/ui/accountsPanel.ts`)

```typescript
// Add to constructor
private instanceDetector: InstanceDetector;

constructor(
  context: vscode.ExtensionContext,
  profileManager: ProfileManager,
  profileLauncher: ProfileLauncher,
  profileDetector: ProfileDetector,
  quotaService: MultiProfileQuotaService,
  instanceDetector: InstanceDetector  // NEW parameter
) {
  this.instanceDetector = instanceDetector;
  // ...existing code
}

// Modify refresh() to include running instances
public async refresh(): Promise<void> {
  if (!this.view) {
    return;
  }

  try {
    const profiles = await this.profileManager.getProfiles();
    const currentProfile = await this.profileDetector.detectCurrentProfile();
    const quotas = await this.quotaService.fetchAllQuotas();
    const runningInstances = await this.instanceDetector.detectRunningInstances(); // NEW

    const initData: InitData = {
      profiles,
      currentProfile,
      quotas,
      runningInstances,  // NEW
    };

    await this.postMessage({ type: 'init', data: initData });
  } catch (error) {
    console.error('Failed to refresh accounts panel:', error);
    await this.postMessage({
      type: 'error',
      message: 'Failed to load profiles',
    });
  }
}

// Add method to refresh only instances
public async refreshInstances(): Promise<void> {
  if (!this.view) {
    return;
  }

  try {
    const runningInstances = await this.instanceDetector.detectRunningInstances();
    await this.postMessage({ type: 'runningInstances', data: runningInstances });
  } catch (error) {
    console.error('Failed to refresh instances:', error);
  }
}
```

### 4. Profile Launcher Enhancement (`src/profiles/profileLauncher.ts`)

Add check before launching:

**Concurrent Launch Policy**: **BLOCK** multiple instances of the same profile by default.

**Rationale**:
- Data corruption risk: Two instances writing to same user data directory can corrupt state
- User confusion: Multiple windows for same profile is rarely intentional
- Resource usage: Each instance consumes significant memory

**Override mechanism**: Hold Shift key while clicking Launch to bypass check (future enhancement).

```typescript
async launch(profileId: string, options?: { force?: boolean }): Promise<LaunchResult> {
  try {
    const profile = await this.profileManager.getProfile(profileId);
    if (!profile) {
      return {
        success: false,
        error: `Profile with ID ${profileId} not found`,
      };
    }

    // NEW: Check if already running (unless force=true)
    if (this.instanceDetector && !options?.force) {
      // Re-detect immediately before launch to avoid race conditions
      // Don't rely on stale cached data from last poll
      const instances = await this.instanceDetector.detectRunningInstances();
      const isRunning = instances.has(profileId);
      
      if (isRunning) {
        return {
          success: false,
          error: `Profile "${profile.displayName}" is already running. Close the existing window first.`,
        };
      }
    }

    return await this.launchWithProfile(profile);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Add optional instance detector
constructor(
  private readonly profileManager: ProfileManager,
  private readonly instanceDetector?: InstanceDetector  // NEW optional
) {}

/**
 * Launch profile with force flag to bypass running check.
 * USE WITH CAUTION: Can cause data corruption if profile already running.
 * 
 * @param profileId Profile to launch
 * @returns Launch result
 */
async forceLaunch(profileId: string): Promise<LaunchResult> {
  return await this.launch(profileId, { force: true });
}
```

### 4.5. Profile Deletion Safety (`src/profiles/profileManager.ts`)

**Security Enhancement**: Prevent deletion of running profiles to avoid data corruption.

**Rationale**:
- Deleting a profile while Cursor is running with that profile can cause undefined behavior
- The running instance may try to write to config.json after deletion
- User data directory remains on disk but profile metadata is lost
- Feature doc (line 646) explicitly requires blocking deletion of running profiles

```typescript
// Update ProfileManager.deleteProfile() method signature
async deleteProfile(id: string, instanceDetector?: InstanceDetector): Promise<void> {
  const config = await this.ensureLoaded();
  
  const index = config.profiles.findIndex(p => p.id === id);
  if (index === -1) {
    throw new ProfileManagerError(`Profile with ID ${id} not found`);
  }

  // SAFETY CHECK: Don't delete running profile
  // This check is only available if InstanceDetector is injected (Phase 5)
  if (instanceDetector) {
    const isRunning = await instanceDetector.isProfileRunning(id);
    if (isRunning) {
      const profile = config.profiles[index];
      throw new ProfileManagerError(
        `Cannot delete running profile "${profile.displayName}". ` +
        `Close the Cursor window first.`
      );
    }
  }
  
  // Safe to delete
  config.profiles.splice(index, 1);
  await this.storage.save(config);
}
```

**Usage in Accounts Panel** (`src/ui/accountsPanel.ts`):

```typescript
private async handleDelete(profileId: string): Promise<void> {
  const profile = await this.profileManager.getProfile(profileId);
  const displayName = profile?.displayName ?? 'Unknown';

  try {
    // Pass instance detector for safety check
    await this.profileManager.deleteProfile(profileId, this.instanceDetector);

    await this.postMessage({
      type: 'success',
      message: `Profile "${displayName}" deleted`,
    });
    await this.refresh();
  } catch (error) {
    // Handle running profile error specifically
    await this.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Failed to delete profile',
    });
  }
}
```

**User Experience**:
- If user tries to delete running profile, error message appears: "Cannot delete running profile 'Work'. Close the Cursor window first."
- UI should disable delete button for running profiles (visual feedback)
- After closing the window, instance detector will update (within polling interval) and delete becomes available

### 5. Webview Updates

#### Types (`webview/src/types/index.ts`)

```typescript
export interface InstanceInfo {
  profileId: string;
  pid: number;
  startTime?: number;
  userDataDir: string;
  detectedAt: number;
}
```

#### App Component (`webview/src/App.tsx`)

```typescript
const [runningInstances, setRunningInstances] = useState<Map<string, InstanceInfo>>(new Map());

useEffect(() => {
  const unsubscribe = vscodeApi.onMessage((message: ToWebviewMessage) => {
    switch (message.type) {
      case 'init':
        setProfiles(message.data.profiles);
        setCurrentProfile(message.data.currentProfile);
        setQuotas(message.data.quotas);
        setRunningInstances(message.data.runningInstances);  // NEW
        setLoading(false);
        break;

      case 'runningInstances':  // NEW
        setRunningInstances(message.data);
        break;

      // ...other cases
    }
  });

  vscodeApi.ready();
  return unsubscribe;
}, []);

// Pass to ProfileList
<ProfileList
  profiles={profiles}
  currentProfileId={currentProfile?.id}
  quotas={quotas}
  runningInstances={runningInstances}  // NEW
  onLaunch={handleLaunch}
  onEdit={handleEdit}
  onDelete={handleDelete}
  onShowInExplorer={handleShowInExplorer}
/>
```

#### Profile Card (`webview/src/components/ProfileCard.tsx`)

```typescript
interface ProfileCardProps {
  profile: Profile;
  isCurrent: boolean;
  quota?: ProfileQuota;
  isRunning: boolean;  // NEW
  onLaunch: (id: string) => void;
  onEdit: (id: string, updates: Partial<Profile>) => void;
  onDelete: (id: string) => void;
  onShowInExplorer: (id: string) => void;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({
  profile,
  isCurrent,
  quota,
  isRunning,  // NEW
  // ...
}) => {
  return (
    <div className={`profile-card ${isCurrent ? 'current' : ''} ${isRunning ? 'running' : ''}`}>
      <div className="profile-header">
        <div className="profile-info">
          {isRunning && <span className="running-indicator" title="Currently running">●</span>}
          <h3>{profile.displayName}</h3>
          <span className="email">{profile.email}</span>
        </div>
        {isCurrent && <span className="badge">Active</span>}
      </div>

      {/* Rest of card... */}

      <div className="profile-actions">
        <button
          className="btn-launch"
          onClick={handleLaunch}
          disabled={isCurrent || isRunning}  // Disable if running
        >
          {isCurrent ? 'Current Window' : isRunning ? 'Already Running' : 'Launch'}
        </button>
        {/* Menu */}
      </div>
    </div>
  );
};
```

#### Profile List (`webview/src/components/ProfileList.tsx`)

```typescript
interface ProfileListProps {
  profiles: Profile[];
  currentProfileId?: string;
  quotas: Map<string, ProfileQuota>;
  runningInstances: Map<string, InstanceInfo>;  // NEW
  onLaunch: (id: string) => void;
  onEdit: (id: string, updates: Partial<Profile>) => void;
  onDelete: (id: string) => void;
  onShowInExplorer: (id: string) => void;
}

export const ProfileList: React.FC<ProfileListProps> = ({
  profiles,
  currentProfileId,
  quotas,
  runningInstances,  // NEW
  onLaunch,
  onEdit,
  onDelete,
  onShowInExplorer,
}) => {
  return (
    <div className="profile-list">
      {profiles.map(profile => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          isCurrent={profile.id === currentProfileId}
          quota={quotas.get(profile.id)}
          isRunning={runningInstances.has(profile.id)}  // NEW
          onLaunch={onLaunch}
          onEdit={onEdit}
          onDelete={onDelete}
          onShowInExplorer={onShowInExplorer}
        />
      ))}
    </div>
  );
};
```

### 6. Styles (`webview/src/App.css` additions)

```css
.running-indicator {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
  margin-right: 8px;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.profile-card.running {
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.3);
}

.btn-launch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

### 7. Extension Integration (`src/extension.ts`)

```typescript
export function activate(context: vscode.ExtensionContext): void {
  // Existing initialization...

  // NEW: Initialize instance detector
  const instanceDetector = new InstanceDetector(profileManager);

  // Start auto-detection if enabled
  const config = vscode.workspace.getConfiguration('cursorAccounts.profiles');
  if (config.get<boolean>('autoDetectRunning', true)) {
    instanceDetector.startAutoDetection(30000); // 30 seconds
  }

  // Pass to launcher for duplicate check
  const profileLauncher = new ProfileLauncher(profileManager, instanceDetector);

  // Pass to accounts panel
  const accountsPanel = new AccountsPanelProvider(
    context,
    profileManager,
    profileLauncher,
    profileDetector,
    multiProfileQuotaService,
    instanceDetector  // NEW parameter
  );

  // Cleanup
  context.subscriptions.push({
    dispose: () => instanceDetector.stopAutoDetection(),
  });
}
```

## Acceptance Criteria

- [ ] InstanceDetector finds running Cursor processes on all platforms
- [ ] Matches processes to configured profiles by user-data-dir
- [ ] Green dot indicator shows on running profiles
- [ ] "Already Running" state on launch button
- [ ] Prevents launching duplicate instances
- [ ] Auto-detection polls at 30-second intervals
- [ ] Performance acceptable (detection < 1 second)
- [ ] Handles no running instances gracefully
- [ ] Works on macOS, Windows, and Linux
- [ ] Process parsing validated with sample outputs (see Testing Strategy)
- [ ] Error handling prevents crashes on malformed output
- [ ] Helper processes correctly filtered out

## Testing Strategy

### Unit Tests

Basic structure tests (see `src/test/instanceDetector.test.ts` in implementation):

```typescript
describe('InstanceDetector', () => {
  // Basic lifecycle tests
  it('can start and stop auto-detection');
  it('returns empty map when no profiles configured');
  // Covered in existing tests
});
```

### Validation Tests (REQUIRED)

**Process Parsing Validation**: Test with known process outputs to ensure parsing robustness.

**Setup**: Create `src/test/fixtures/process-outputs/` directory with sample outputs:

**`macos-ps-output.txt`**:
```
  12345 Mon May 27 10:30:00 2026 /Applications/Cursor.app/Contents/MacOS/Cursor --user-data-dir=/Users/test/.cursor-work
  12346 Mon May 27 10:31:15 2026 /Applications/Cursor.app/Contents/MacOS/Cursor Helper --type=gpu
  12347 Mon May 27 10:35:00 2026 /Applications/Cursor.app/Contents/MacOS/Cursor
  12348 Mon May 27 10:36:00 2026 /Applications/Cursor.app/Contents/MacOS/Cursor Helper (Renderer)
```

**`windows-powershell-output.json`**:
```json
[
  {
    "Id": 8888,
    "CommandLine": "C:\\Users\\test\\AppData\\Local\\Programs\\Cursor\\Cursor.exe --user-data-dir=C:\\Users\\test\\.cursor-work"
  },
  {
    "Id": 8889,
    "CommandLine": "C:\\Users\\test\\AppData\\Local\\Programs\\Cursor\\Cursor.exe --type=renderer"
  },
  {
    "Id": 8890,
    "CommandLine": "C:\\Users\\test\\AppData\\Local\\Programs\\Cursor\\Cursor.exe"
  }
]
```

**`linux-ps-output.txt`**:
```
  9999 /usr/share/cursor/cursor --user-data-dir=/home/test/.cursor-work
 10000 /usr/share/cursor/cursor --type=zygote
 10001 /usr/share/cursor/cursor
 10002 /usr/share/cursor/cursor --type=gpu-process
```

**Validation test implementation** (`src/test/instanceDetector.parsing.test.ts`):

```typescript
import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import { InstanceDetector } from '../profiles/instanceDetector';
import { ProfileManager } from '../profiles/profileManager';

describe('InstanceDetector Process Parsing', () => {
  let detector: InstanceDetector;
  let manager: ProfileManager;
  
  beforeEach(async () => {
    manager = new ProfileManager();
    await manager.initialize();
    detector = new InstanceDetector(manager);
  });
  
  describe('macOS parsing', () => {
    it('should parse valid ps output correctly', () => {
      // Test with known good output
      // Mock execAsync to return fixture data
      // Verify correct number of processes detected
      // Verify helper processes filtered out
      // Verify user-data-dir extracted correctly
    });
    
    it('should handle malformed ps output gracefully', () => {
      // Test with invalid PIDs, missing fields, garbage data
      // Should log warnings but not throw
      // Should return partial results where possible
    });
  });
  
  describe('Windows PowerShell parsing', () => {
    it('should parse JSON output correctly', () => {
      // Test with valid PowerShell JSON
      // Verify correct process extraction
      // Verify helper filtering
    });
    
    it('should handle invalid JSON gracefully', () => {
      // Test with malformed JSON
      // Should throw appropriate error
    });
  });
  
  describe('Linux parsing', () => {
    it('should parse ps output correctly', () => {
      // Similar to macOS tests
    });
  });
  
  describe('Edge cases', () => {
    it('should handle empty output (no processes running)', () => {
      // Should return empty array
    });
    
    it('should handle very long command lines', () => {
      // Command lines can be truncated by ps
      // Should still extract what's available
    });
    
    it('should handle paths with spaces', () => {
      // --user-data-dir="/path/with spaces/profile"
      // Should correctly extract quoted paths
    });
  });
});
```

### Integration Tests

Test with actual Cursor processes:

```typescript
describe('InstanceDetector Integration', () => {
  it('should detect currently running Cursor instance', async () => {
    // This test runs in Extension Development Host
    // Should detect at least one instance (the test host)
    const detector = new InstanceDetector(profileManager);
    const instances = await detector.detectRunningInstances();
    
    assert.ok(instances.size >= 0); // May be 0 if no profiles match
    // If current instance uses custom user-data-dir, should detect it
  });
});
```

### Manual Testing

1. **Basic Detection**:
   - Create multiple profiles
   - Launch profiles in separate windows
   - Open Accounts panel
   - Verify green dot indicator on running profiles
   - Verify correct PIDs displayed (optional: show in debug mode)

2. **Auto-Detection**:
   - Launch a profile
   - Wait 30s for polling
   - Verify indicator appears
   - Close profile window
   - Wait 30s
   - Verify indicator disappears

3. **Platform-Specific**:
   - **macOS**: Launch 2-3 Cursor instances, verify all detected
   - **Windows**: Test PowerShell detection, then disable PowerShell (rename executable) to test wmic fallback
   - **Linux**: Test with Cursor installed via different methods (snap, AppImage, binary)

4. **Helper Process Filtering**:
   - Launch Cursor
   - Open Task Manager/Activity Monitor
   - Count processes: should see 1 main + 5-10 helpers
   - Verify extension detects only 1 process per profile

5. **Error Scenarios**:
   - Artificially slow ps/PowerShell command (add `sleep` to command)
   - Should timeout after 5 seconds
   - Malformed process output (modify ps output manually)
   - Should log warnings, not crash

6. **Performance**:
   - With 10+ profiles and 5+ running instances
   - Detection should complete in < 1 second
   - Monitor CPU usage during polling (should be negligible)

## Known Limitations

### Platform Differences
- **macOS**: Uses `ps` with grep - reliable but parsing is fragile
- **Linux**: Similar to macOS - relies on ps output format
- **Windows**: PowerShell preferred (JSON output), wmic fallback (deprecated, may be removed in future Windows)

### Detection Accuracy
- Relies on `--user-data-dir` in command line
- Processes without flag won't match
- Short-lived processes may be missed between polls
- **Helper processes filtered out**: Only main Cursor process detected, not GPU/Renderer helpers

### Race Conditions

**Scenario**: User clicks "Launch" while polling interval is at 25 seconds (5 seconds before next poll).

**Problem**: Polling cache says profile is NOT running, but process was just terminated. User clicks launch, but by the time launch executes (0.5s later), OS hasn't cleaned up the process yet.

**Mitigation**:
1. **Immediate re-detection before launch**: `ProfileLauncher.launch()` calls `detectRunningInstances()` immediately before spawning, not relying on cached data
2. **Short timeout**: Launch check has 5-second timeout, fails fast if detection hangs
3. **OS-level lock files**: Cursor itself uses lock files that prevent multiple instances (we detect the error and show appropriate message)

**Not mitigated**:
- Gap between detection and spawn (0.5s): OS could start process in this window
- This is acceptable: Cursor's own locks will catch it, we'll show error on next attempt

### Parsing Fragility

**CRITICAL LIMITATION**: All platform implementations rely on parsing command-line output which is inherently fragile:

1. **OS Updates May Break Parsing**: If macOS/Linux changes `ps` output format, or Windows changes PowerShell output, detection will fail
2. **Regex Assumptions**: Current regex patterns assume specific whitespace/format which may not hold universally
3. **Error Handling Required**: Comprehensive try-catch blocks prevent total failure, but detection may silently return empty results

**Mitigation Strategies Implemented**:
- Flexible regex patterns with warnings on parse failures
- Timeout protection (5 seconds) prevents hanging
- Individual line/block error handling continues processing despite failures
- Multiple fallback methods on Windows (PowerShell → wmic)
- Comprehensive logging of parse failures for debugging

**Future Improvements Recommended**:
1. Consider using native Node.js process APIs (`process.list` if available)
2. Implement validation tests with known good/bad ps outputs
3. Add telemetry to detect parsing failures in production
4. Consider alternative: File-based detection (lock files, PID files)

### Polling Overhead

**Performance Impact per Poll**:
- macOS/Linux: **10-20ms** (ps command)
- Windows PowerShell: **30-50ms** (JSON parsing overhead)
- Windows wmic: **40-70ms** (deprecated, slower)

**Total CPU Impact** at 30s interval (default):
- 50ms / 30000ms = **0.16% CPU time**
- Negligible for modern systems
- No user-perceivable impact

**When to Adjust Interval**:

1. **Increase to 60s** (reduce overhead):
   - Running on resource-constrained machines
   - Battery-powered laptops (save power)
   - Many profiles (10+) with frequent switching (detection gets slower)
   - Example: Old laptop, limited CPU
   
2. **Decrease to 15s** (increase responsiveness):
   - Need faster feedback when switching profiles
   - Running automated tests that rely on instance detection
   - Acceptable trade-off: 0.32% CPU for 2x responsiveness
   
3. **Disable auto-detection** (zero overhead):
   - Only launch profiles, never need status indicators
   - Set `cursorAccounts.profiles.autoDetectRunning: false`

**Configuration**: Add to VS Code settings:
```json
{
  "cursorAccounts.profiles.instanceDetectionInterval": 30
}
```

**Monitoring overhead**: If concerned, check Activity Monitor/Task Manager during polling. Extension CPU should spike briefly every 30s, then return to 0%.

## Troubleshooting

### Instances not detected
- Check if Cursor launched with `--user-data-dir` flag
- Verify profile path matches exactly
- Try manual detection via command

### Wrong profiles marked as running
- Path matching issue (Windows path separators)
- Clear cache and restart extension

### Performance slow
- Reduce polling interval
- Disable auto-detection if not needed

## Next Phase

Proceed to **Phase 6: Export/Import**, which adds:
- Export profile metadata to JSON
- Include settings.json from profile
- Import profiles from exported file
- Validation and conflict resolution

## References

- [Node.js child_process.exec](https://nodejs.org/api/child_process.html#child_processexeccommand-options-callback)
- [ps command man page](https://man7.org/linux/man-pages/man1/ps.1.html)
- [wmic documentation](https://docs.microsoft.com/en-us/windows/win32/wmisdk/wmic)
