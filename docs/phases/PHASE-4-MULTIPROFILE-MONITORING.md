# Phase 4: Multi-Profile Monitoring

## Overview

Phase 4 adds the ability to monitor quota usage across ALL configured profiles simultaneously, not just the current window's profile. This transforms the extension from single-profile monitoring to a comprehensive dashboard view where users can see at a glance which accounts are approaching their limits, even for profiles not currently running.

## Goals

- Read tokens from any profile's `state.vscdb` (not just current)
- Fetch quotas for all profiles in parallel using existing API
- Cache quota data per profile with timestamps
- Display quota indicators in profile cards (Accounts panel)
- Show warning states for profiles approaching limits
- Background refresh on configurable interval
- Handle profiles with missing/expired tokens gracefully

## Prerequisites

- Phase 1, 2, and 3 completed and tested
- Existing `QuotaClient` and `TokenReader` working correctly
- Accounts panel rendering profile list
- Understanding of parallel async operations

## Required Refactoring of Existing Code

**CRITICAL**: Before implementing this phase, the following existing code must be refactored:

### 1. Token Reading Infrastructure

The existing `readAuthFromStateDb` function (likely in `src/auth/tokenReader.ts`) must be updated:

**Current signature** (assumed):
```typescript
function readAuthFromStateDb(extensionPath: string): AuthTokens | null
```

**Required new signature**:
```typescript
function readAuthFromStateDb(stateDbPath: string): Promise<AuthTokens | null>
```

**Changes needed**:
- Accept the full path to `state.vscdb` file instead of extension path
- Make the function async (if not already)
- Add validation to ensure the path is within the user's home directory (security)
- Handle missing or corrupted database files gracefully
- Update all existing callers to use the new signature

### 2. TokenService Architecture

The `TokenService` class must support one of the following approaches:

**Option A: Accept pre-loaded tokens in constructor**
```typescript
class TokenService {
  constructor(
    context: vscode.ExtensionContext,
    preloadedTokens?: AuthTokens  // NEW: optional pre-loaded tokens
  )
}
```

**Option B: Create a ProfileTokenService subclass**
```typescript
class ProfileTokenService extends TokenService {
  constructor(
    context: vscode.ExtensionContext,
    profileTokens: AuthTokens,
    profileUserDataDir: string
  )
}
```

Choose Option A for simpler refactoring, Option B for better separation of concerns.

### 3. Security Considerations

When reading tokens from arbitrary profile directories:

1. **Path validation**: Verify `userDataDir` is within `os.homedir()` to prevent directory traversal
2. **File permissions**: Check read permissions before attempting to access `state.vscdb`
3. **Error handling**: Gracefully handle missing files, corrupted databases, and permission errors
4. **Token isolation**: Ensure tokens from one profile cannot be used to modify another profile's data

Example validation:
```typescript
function validateProfilePath(userDataDir: string): boolean {
  const normalized = path.normalize(path.resolve(userDataDir));
  const home = path.normalize(os.homedir());
  
  // Must be within user's home directory
  if (!normalized.startsWith(home)) {
    throw new Error('Profile directory must be within user home directory');
  }
  
  // Must not be a system directory
  const systemDirs = ['/', '/System', '/usr', '/bin', 'C:\\Windows', 'C:\\Program Files'];
  if (systemDirs.some(sysDir => normalized.startsWith(path.normalize(sysDir)))) {
    throw new Error('Profile directory cannot be a system directory');
  }
  
  return true;
}
```

## Files to Create

```
src/
├── services/
│   └── multiProfileQuotaService.ts   # NEW: Fetch quotas for all profiles
└── test/
    └── multiProfileQuotaService.test.ts # NEW: Unit tests
```

## Files to Modify

```
src/
├── ui/accountsPanel.ts               # MODIFY: Send quota data to webview
├── profiles/types.ts                 # MODIFY: Add ProfileQuota type
└── extension.ts                      # MODIFY: Initialize service

webview/src/
├── components/ProfileCard.tsx        # MODIFY: Display quota indicator
└── types/index.ts                    # MODIFY: Add quota types
```

## Implementation Details

### 1. Profile Quota Type (`src/profiles/types.ts` additions)

```typescript
/**
 * Quota information for a specific profile.
 * 
 * **Error Field Behavior**:
 * - `error` is set when quota fetch fails (expired token, network timeout, API error)
 * - `quota` is null when error is set
 * - UI should display error message or generic "Login required" state
 * 
 * **Common Error States** and UI Treatment:
 * - "No authentication tokens found" → Show "Not logged in - Launch to sign in"
 * - Network timeout / API 500 → Show "Quota unavailable - Try refresh"
 * - Token expired / API 401 → Show "Session expired - Relaunch profile"
 * - Database read error → Show "Cannot read profile data"
 * 
 * **Caching**: Even failed fetches are cached with error state. This allows
 * the UI to show last known good data alongside current error status.
 */
export interface ProfileQuota {
  profileId: string;
  quota: QuotaUsage | null;  // Reuses existing QuotaUsage type
  error?: string;             // Error message if fetch failed
  fetchedAt: number;          // Unix timestamp (ms)
}

/**
 * Status category for quota thresholds.
 */
export type QuotaStatus = 'ok' | 'warning' | 'critical' | 'unavailable';

/**
 * Helper to determine quota status.
 */
export function getQuotaStatus(quota: QuotaUsage | null): QuotaStatus {
  if (!quota) {
    return 'unavailable';
  }

  const percent = quota.totalPercentUsed;
  
  if (percent >= 95) {
    return 'critical';
  }
  if (percent >= 85) {
    return 'warning';
  }
  return 'ok';
}

// Add to ToWebviewMessage union
export type ToWebviewMessage =
  | { type: 'init'; data: InitData }
  | { type: 'profiles'; data: Profile[] }
  | { type: 'currentProfile'; data: Profile | null }
  | { type: 'quotas'; data: Map<string, ProfileQuota> }  // NEW
  | { type: 'error'; message: string }
  | { type: 'success'; message: string };

// Update InitData to include quotas
export interface InitData {
  profiles: Profile[];
  currentProfile: Profile | null;
  quotas: Map<string, ProfileQuota>;  // NEW
}
```

### 2. Multi-Profile Quota Service (`src/services/multiProfileQuotaService.ts`)

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { ProfileManager } from '../profiles/profileManager';
import { Profile, ProfileQuota } from '../profiles/types';
import { QuotaClient } from '../api/quotaClient';
import { TokenService } from '../auth/tokenRefresh';
import { readAuthFromStateDb } from '../auth/tokenReader';
import { QuotaUsage } from '../api/types';

const QUOTA_CACHE_KEY = 'multiProfileQuotaCache';

/**
 * Cache expiration policy: 5 minutes.
 * 
 * **Cache Behavior**:
 * - `fetchAllQuotas()`: ALWAYS fetches fresh data and caches results
 * - `getCachedQuota()`: Returns cached data ONLY if < 5 minutes old
 * - `getAllCachedQuotas()`: Returns all cached data regardless of age
 * 
 * **When cache is invalidated**:
 * - After 5 minutes (stale data not returned by getCachedQuota)
 * - When new fetch completes (overwrites old cache)
 * - NOT invalidated on error (keeps last good data)
 * 
 * **Force refresh**: Call `fetchAllQuotas()` to bypass cache and fetch fresh data.
 */
const CACHE_VALIDITY_MS = 5 * 60 * 1000; // 5 minutes

export class MultiProfileQuotaServiceError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'MultiProfileQuotaServiceError';
  }
}

export class MultiProfileQuotaService {
  private refreshTimer: NodeJS.Timeout | undefined;
  private inFlight = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileManager: ProfileManager
  ) {}

  /**
   * Start background refresh.
   */
  start(intervalSeconds: number = 300): void {
    this.stop();
    
    // Initial fetch
    void this.refreshAll();

    // Set up interval
    this.refreshTimer = setInterval(() => {
      void this.refreshAll();
    }, intervalSeconds * 1000);
  }

  /**
   * Stop background refresh.
   */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /**
   * Fetch quotas for all profiles in parallel.
   * 
   * **Error Handling Strategy** (see feature doc lines 629-703):
   * This method implements "best effort" error recovery - it continues despite
   * individual profile failures and caches partial results. If 3 of 5 profiles
   * succeed, the UI will show those 3 with quota data and display error states
   * for the 2 failed profiles. This is intentional - users prefer seeing
   * partial data over complete failure.
   * 
   * **CRITICAL**: Uses Promise.allSettled (not Promise.all) to prevent
   * fail-fast behavior. Each profile fetch is independent and isolated.
   */
  async fetchAllQuotas(): Promise<Map<string, ProfileQuota>> {
    const profiles = await this.profileManager.getProfiles();
    
    if (profiles.length === 0) {
      return new Map();
    }

    // Fetch all quotas in parallel using allSettled for fault tolerance
    // See feature doc error handling section - we want partial success
    const results = await Promise.allSettled(
      profiles.map(profile => this.fetchQuotaForProfile(profile))
    );

    // Build map of results - ALWAYS include both successes and failures
    const quotaMap = new Map<string, ProfileQuota>();
    
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      const result = results[i];

      if (result.status === 'fulfilled') {
        // Success: cache quota data
        quotaMap.set(profile.id, result.value);
      } else {
        // Failure: cache error state (NOT omit the profile)
        // UI will show "Login required" or specific error message
        quotaMap.set(profile.id, {
          profileId: profile.id,
          quota: null,
          error: result.reason?.message ?? 'Failed to fetch quota',
          fetchedAt: Date.now(),
        });
      }
    }

    // ALWAYS cache results, even if some/all failed
    // Next fetch may succeed, and we want to show stale data meanwhile
    await this.saveCache(quotaMap);

    return quotaMap;
  }

  /**
   * Fetch quota for a single profile.
   * 
   * NOTE: This method reads tokens from the specified profile's user data directory,
   * NOT the current extension context. The readAuthFromStateDb function must be
   * updated to accept a userDataDir parameter instead of extensionPath.
   */
  async fetchQuotaForProfile(profile: Profile): Promise<ProfileQuota> {
    try {
      // Read tokens from profile's state.vscdb
      // IMPORTANT: readAuthFromStateDb must be modified to accept the profile's
      // user data directory path, not the extension path
      const stateDbPath = this.getStateDbPath(profile.userDataDir);
      const tokens = await this.readTokensFromProfile(profile.userDataDir);

      if (!tokens || !tokens.accessToken) {
        return {
          profileId: profile.id,
          quota: null,
          error: 'No authentication tokens found. Launch profile to sign in.',
          fetchedAt: Date.now(),
        };
      }

      // Create temporary TokenService for this profile with the profile's tokens
      // Note: TokenService needs to be instantiated with tokens from the target profile
      const tokenService = this.createTokenServiceForProfile(tokens);
      const quotaClient = new QuotaClient(tokenService);

      // Fetch quota (reuses existing infrastructure)
      const quota = await quotaClient.getUsage();

      return {
        profileId: profile.id,
        quota,
        fetchedAt: Date.now(),
      };
    } catch (error) {
      return {
        profileId: profile.id,
        quota: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        fetchedAt: Date.now(),
      };
    }
  }

  /**
   * Read authentication tokens from a specific profile's user data directory.
   * This is a wrapper around the existing readAuthFromStateDb that correctly
   * reads from the target profile's directory.
   * 
   * @param userDataDir Absolute path to the profile's user data directory
   * @returns Authentication tokens or null if not found
   */
  private async readTokensFromProfile(userDataDir: string): Promise<{ accessToken: string; refreshToken?: string } | null> {
    try {
      // Implementation note: The existing readAuthFromStateDb function needs to be
      // refactored to accept a userDataDir parameter. For now, this method should:
      // 1. Construct the full path to state.vscdb: ${userDataDir}/User/globalStorage/state.vscdb
      // 2. Read and parse the SQLite database
      // 3. Extract auth tokens from the appropriate table
      // 
      // Security consideration: Reading from arbitrary directories requires validation:
      // - Verify the path is within user's home directory
      // - Check file permissions before reading
      // - Handle missing or corrupted database files gracefully
      
      const stateDbPath = path.join(userDataDir, 'User', 'globalStorage', 'state.vscdb');
      
      // Check if file exists and is readable
      try {
        await fs.access(stateDbPath, fs.constants.R_OK);
      } catch {
        return null; // File doesn't exist or not readable
      }
      
      // Use existing token reading infrastructure, but pointed at the profile's db
      // This requires readAuthFromStateDb to be refactored to:
      // readAuthFromStateDb(stateDbPath: string): Promise<AuthTokens | null>
      const tokens = await readAuthFromStateDb(stateDbPath);
      
      return tokens;
    } catch (error) {
      console.error(`Failed to read tokens from ${userDataDir}:`, error);
      return null;
    }
  }

  /**
   * Create a TokenService instance using tokens from a specific profile.
   * This is necessary because the default TokenService reads from the current context,
   * but we need to use tokens from a different profile.
   * 
   * @param tokens Authentication tokens from the target profile
   * @returns TokenService configured with the provided tokens
   */
  private createTokenServiceForProfile(tokens: { accessToken: string; refreshToken?: string }): TokenService {
    // Implementation note: TokenService may need to be refactored to accept
    // pre-loaded tokens instead of always reading from the current context.
    // Alternatively, create a mock TokenService that returns the provided tokens.
    
    // This is a placeholder implementation. The actual implementation should:
    // 1. Create a TokenService that uses the provided tokens
    // 2. Ensure token refresh works correctly for the target profile
    // 3. Handle token expiration by returning appropriate errors
    
    // For now, this represents the interface that needs to be implemented
    throw new Error('createTokenServiceForProfile needs implementation based on existing TokenService architecture');
  }

  /**
   * Refresh all quotas (with deduplication).
   */
  async refreshAll(): Promise<Map<string, ProfileQuota>> {
    if (this.inFlight) {
      // Return cached data if refresh already in progress
      return this.loadCache();
    }

    try {
      this.inFlight = true;
      return await this.fetchAllQuotas();
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Get cached quota for a profile.
   */
  async getCachedQuota(profileId: string): Promise<ProfileQuota | undefined> {
    const cache = await this.loadCache();
    const cached = cache.get(profileId);

    if (!cached) {
      return undefined;
    }

    // Check if cache is still valid
    const age = Date.now() - cached.fetchedAt;
    if (age > CACHE_VALIDITY_MS) {
      return undefined;
    }

    return cached;
  }

  /**
   * Get all cached quotas.
   */
  async getAllCachedQuotas(): Promise<Map<string, ProfileQuota>> {
    return this.loadCache();
  }

  /**
   * Clear all cached quotas.
   */
  async clearCache(): Promise<void> {
    await this.context.globalState.update(QUOTA_CACHE_KEY, undefined);
  }

  /**
   * Get state.vscdb path for a profile's user data directory.
   */
  private getStateDbPath(userDataDir: string): string {
    return path.join(userDataDir, 'User', 'globalStorage', 'state.vscdb');
  }

  /**
   * Save quota cache to global state.
   */
  private async saveCache(quotas: Map<string, ProfileQuota>): Promise<void> {
    // Convert Map to array for JSON serialization
    const array = Array.from(quotas.entries()).map(([id, quota]) => ({
      id,
      quota,
    }));

    await this.context.globalState.update(QUOTA_CACHE_KEY, array);
  }

  /**
   * Load quota cache from global state.
   */
  private async loadCache(): Promise<Map<string, ProfileQuota>> {
    const cached = this.context.globalState.get<
      Array<{ id: string; quota: ProfileQuota }>
    >(QUOTA_CACHE_KEY);

    if (!cached) {
      return new Map();
    }

    // Convert array back to Map
    return new Map(cached.map(item => [item.id, item.quota]));
  }
}
```

**Unit tests** (`src/test/multiProfileQuotaService.test.ts`):

```typescript
import { strict as assert } from 'assert';
import * as path from 'path';
import * as os from 'os';
import { MultiProfileQuotaService } from '../services/multiProfileQuotaService';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';

describe('MultiProfileQuotaService', () => {
  let manager: ProfileManager;
  let service: MultiProfileQuotaService;
  let mockContext: any;

  beforeEach(async () => {
    const storage = new ProfileStorage(path.join(os.tmpdir(), 'test-config'));
    manager = new ProfileManager(storage);
    await manager.initialize();

    mockContext = {
      extensionPath: __dirname,
      globalState: {
        get: () => undefined,
        update: async () => {},
      },
    };

    service = new MultiProfileQuotaService(mockContext, manager);
  });

  describe('fetchAllQuotas', () => {
    it('returns empty map when no profiles', async () => {
      const quotas = await service.fetchAllQuotas();
      assert.equal(quotas.size, 0);
    });

    it('returns map with profile IDs as keys', async () => {
      const profile = await manager.createProfile({ email: 'test@example.com' });
      
      const quotas = await service.fetchAllQuotas();
      
      assert.ok(quotas.has(profile.id));
    });

    it('includes error for profiles without tokens', async () => {
      const profile = await manager.createProfile({ email: 'test@example.com' });
      
      const quotas = await service.fetchAllQuotas();
      const quota = quotas.get(profile.id);
      
      assert.ok(quota);
      assert.equal(quota.quota, null);
      assert.ok(quota.error);
    });

    it('sets fetchedAt timestamp', async () => {
      const profile = await manager.createProfile({ email: 'test@example.com' });
      
      const before = Date.now();
      const quotas = await service.fetchAllQuotas();
      const after = Date.now();
      
      const quota = quotas.get(profile.id);
      assert.ok(quota);
      assert.ok(quota.fetchedAt >= before && quota.fetchedAt <= after);
    });
  });

  describe('getCachedQuota', () => {
    it('returns undefined for non-existent profile', async () => {
      const cached = await service.getCachedQuota('non-existent');
      assert.equal(cached, undefined);
    });
  });

  describe('clearCache', () => {
    it('clears cached quotas', async () => {
      await service.clearCache();
      
      const cached = await service.getAllCachedQuotas();
      assert.equal(cached.size, 0);
    });
  });

  describe('lifecycle', () => {
    it('can start and stop background refresh', () => {
      service.start(60);
      service.stop();
      // No assertion, just ensure no errors
      assert.ok(true);
    });
  });
});
```

### 3. Accounts Panel Integration (`src/ui/accountsPanel.ts`)

Modify to fetch and send quota data:

```typescript
// Add to constructor or as property
private quotaService: MultiProfileQuotaService;

constructor(
  context: vscode.ExtensionContext,
  profileManager: ProfileManager,
  profileLauncher: ProfileLauncher,
  profileDetector: ProfileDetector,
  quotaService: MultiProfileQuotaService  // NEW parameter
) {
  this.quotaService = quotaService;
  // ...existing code
}

// Modify refresh() method
public async refresh(): Promise<void> {
  if (!this.view) {
    return;
  }

  try {
    const profiles = await this.profileManager.getProfiles();
    const currentProfile = await this.profileDetector.detectCurrentProfile();
    
    // NEW: Fetch quotas for all profiles
    const quotas = await this.quotaService.fetchAllQuotas();

    const initData: InitData = {
      profiles,
      currentProfile,
      quotas,  // NEW
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

// Add method to send quota updates independently
public async refreshQuotas(): Promise<void> {
  if (!this.view) {
    return;
  }

  try {
    const quotas = await this.quotaService.fetchAllQuotas();
    await this.postMessage({ type: 'quotas', data: quotas });
  } catch (error) {
    console.error('Failed to refresh quotas:', error);
  }
}
```

### 4. Webview Types (`webview/src/types/index.ts`)

```typescript
export interface ProfileQuota {
  profileId: string;
  quota: QuotaUsage | null;
  error?: string;
  fetchedAt: number;
}

export interface QuotaUsage {
  totalPercentUsed: number;
  autoPercentUsed: number;
  apiPercentUsed: number;
  totalSpend: number;
  includedSpend: number;
  remaining: number;
  limit: number;
  billingCycleStart: string;
  billingCycleEnd: string;
  displayMessage?: string;
  accountEmail?: string;
  fetchedAt: number;
}

export type QuotaStatus = 'ok' | 'warning' | 'critical' | 'unavailable';

export function getQuotaStatus(quota: QuotaUsage | null): QuotaStatus {
  if (!quota) {
    return 'unavailable';
  }

  const percent = quota.totalPercentUsed;
  
  if (percent >= 95) {
    return 'critical';
  }
  if (percent >= 85) {
    return 'warning';
  }
  return 'ok';
}
```

### 5. Token Expiration and Re-authentication

**User Flow for Expired Tokens**:

1. **Detection**: Quota fetch returns 401 or tokens not found
2. **UI State**: Profile card shows "Authentication required" instead of quota
3. **User Action**: User can click "Re-authenticate" button
4. **Re-auth Method**: Launches the profile (which triggers Cursor's normal auth flow)
5. **Retry**: After user signs in, quota refreshes automatically on next poll

**Error Messages**:
- **No tokens found**: "Launch this profile and sign in to see quota"
- **Expired tokens**: "Authentication expired. Launch profile to sign in again"
- **Auth error**: "Unable to authenticate. Launch profile to sign in"

**UI Implementation**:

The ProfileQuota type already includes an `error` field for this purpose:
```typescript
interface ProfileQuota {
  profileId: string;
  quota: QuotaUsage | null;
  error?: string;  // "Authentication required" or specific error
  fetchedAt: number;
}
```

In ProfileCard, check for auth errors:
```typescript
if (quota?.error) {
  if (quota.error.includes('authentication') || quota.error.includes('token')) {
    // Show re-auth UI
    return (
      <div className="quota-auth-required">
        <span className="icon">🔒</span>
        <span>Authentication required</span>
        <button onClick={() => onLaunch(profile.id)}>
          Sign In
        </button>
      </div>
    );
  }
}
```

**Automatic Token Refresh** (Future Enhancement):

Current implementation does NOT attempt automatic token refresh. This is by design:
- Simpler implementation for Phase 4
- Avoids complex refresh token handling
- Leverages Cursor's built-in auth when user launches profile

Future enhancement could implement:
- Automatic refresh token usage in `TokenService`
- Background token refresh before expiration
- More seamless UX (no launch required)

### 6. Profile Card with Quota (`webview/src/components/ProfileCard.tsx`)

Add quota indicator to profile card:

```typescript
interface ProfileCardProps {
  profile: Profile;
  isCurrent: boolean;
  quota?: ProfileQuota;  // NEW
  onLaunch: (id: string) => void;
  onEdit: (id: string, updates: Partial<Profile>) => void;
  onDelete: (id: string) => void;
  onShowInExplorer: (id: string) => void;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({
  profile,
  isCurrent,
  quota,  // NEW
  // ...other props
}) => {
  const quotaStatus = quota?.quota ? getQuotaStatus(quota.quota) : 'unavailable';

  return (
    <div className={`profile-card ${isCurrent ? 'current' : ''} quota-${quotaStatus}`}>
      {/* Existing header content */}

      {/* NEW: Quota indicator */}
      {quota && (
        <div className="quota-section">
          {quota.error ? (
            <div className="quota-error">
              <span className="icon">⚠️</span>
              <span>{quota.error}</span>
            </div>
          ) : quota.quota ? (
            <>
              <div className="quota-bar">
                <div
                  className={`quota-fill ${quotaStatus}`}
                  style={{ width: `${quota.quota.totalPercentUsed}%` }}
                />
              </div>
              <div className="quota-text">
                <span className="percent">{quota.quota.totalPercentUsed.toFixed(0)}%</span>
                <span className="label">used</span>
                {quotaStatus === 'warning' && <span className="warning-icon">⚠️</span>}
                {quotaStatus === 'critical' && <span className="error-icon">🔴</span>}
              </div>
              <div className="quota-details">
                <span>Remaining: ${(quota.quota.remaining / 100).toFixed(2)}</span>
                <span>Resets: {formatDate(quota.quota.billingCycleEnd)}</span>
              </div>
            </>
          ) : (
            <div className="quota-unavailable">
              Quota data unavailable
            </div>
          )}
        </div>
      )}

      {/* Existing actions */}
    </div>
  );
};

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const days = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  
  if (days === 0) {
    return 'Today';
  } else if (days === 1) {
    return 'Tomorrow';
  } else {
    return `${days} days`;
  }
}
```

### 6. Quota Styles (`webview/src/App.css` additions)

```css
.quota-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.quota-bar {
  height: 6px;
  background: var(--bg-primary);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}

.quota-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.quota-fill.ok {
  background: #10b981;
}

.quota-fill.warning {
  background: #f59e0b;
}

.quota-fill.critical {
  background: #ef4444;
}

.quota-fill.unavailable {
  background: var(--fg-secondary);
}

.quota-text {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 4px;
}

.quota-text .percent {
  font-weight: 600;
  font-size: 16px;
}

.quota-text .label {
  color: var(--fg-secondary);
}

.quota-text .warning-icon,
.quota-text .error-icon {
  margin-left: auto;
}

.quota-details {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--fg-secondary);
}

.quota-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--error-bg);
  border-radius: 4px;
  font-size: 12px;
}

.quota-unavailable {
  text-align: center;
  color: var(--fg-secondary);
  font-size: 12px;
  padding: 8px;
}

.quota-auth-required {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--error-bg);
  border-radius: 4px;
  text-align: center;
}

.quota-auth-required .icon {
  font-size: 24px;
}

.quota-auth-required button {
  padding: 6px 12px;
  background: var(--button-bg);
  color: var(--button-fg);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.quota-auth-required button:hover {
  background: var(--button-hover);
}

/* Profile card quota status colors */
.profile-card.quota-critical {
  border-left-color: #ef4444 !important;
}

.profile-card.quota-warning {
  border-left-color: #f59e0b !important;
}
```

### 7. Extension Integration (`src/extension.ts`)

Initialize and start the quota service:

```typescript
export function activate(context: vscode.ExtensionContext): void {
  // Existing initialization...

  // NEW: Initialize multi-profile quota service
  const multiProfileQuotaService = new MultiProfileQuotaService(
    context,
    profileManager
  );

  // Start background refresh (default 5 minutes)
  const config = vscode.workspace.getConfiguration('cursorAccounts.profiles');
  const refreshInterval = config.get<number>('refreshAllInterval', 300);
  multiProfileQuotaService.start(refreshInterval);

  // Pass to accounts panel
  const accountsPanel = new AccountsPanelProvider(
    context,
    profileManager,
    profileLauncher,
    profileDetector,
    multiProfileQuotaService  // NEW parameter
  );

  // Cleanup on deactivate
  context.subscriptions.push({
    dispose: () => multiProfileQuotaService.stop(),
  });
}
```

### 8. Configuration (`package.json`)

Add settings for quota refresh:

```json
{
  "contributes": {
    "configuration": {
      "properties": {
        "cursorAccounts.profiles.refreshAllInterval": {
          "type": "number",
          "default": 300,
          "minimum": 60,
          "maximum": 3600,
          "description": "Interval in seconds for refreshing all profile quotas (60-3600)."
        }
      }
    }
  }
}
```

## User Workflows

### Viewing Multi-Profile Quotas

1. User opens Accounts panel
2. Extension fetches quotas for all profiles in parallel
3. Each profile card shows:
   - Progress bar colored by status (green/yellow/red)
   - Percentage used
   - Warning icon if >85%
   - Days until reset
4. User sees at a glance which accounts need attention

### Responding to Warning

1. User sees Work profile at 92% (warning state)
2. Card shows red warning icon
3. User can:
   - Launch Work profile to review usage
   - See days until reset
   - Plan work accordingly

## Testing Strategy

### Unit Tests
```bash
pnpm test
```

### Manual Testing

1. **Create multiple profiles** with different accounts
2. **Sign in to each** (launch and authenticate)
3. **Open Accounts panel** and verify:
   - Quotas display for all signed-in profiles
   - Profiles without auth show "No tokens" message
   - Percentages match Cursor Settings → Usage
4. **Test refresh**:
   - Use Cursor to consume quota
   - Wait for background refresh (or trigger manual)
   - Verify numbers update
5. **Test warning states**:
   - Mock high usage (edit cached data)
   - Verify warning/critical colors show

### Performance Testing

- Create 10+ profiles
- Measure time to fetch all quotas
- Should complete in < 5 seconds even with slow network

## Acceptance Criteria

- [ ] MultiProfileQuotaService fetches quotas in parallel
- [ ] Quota data displayed in profile cards
- [ ] Color-coded progress bars (green/yellow/red)
- [ ] Warning icons for profiles >85%
- [ ] "No tokens" message for unsigned profiles
- [ ] Background refresh on configurable interval
- [ ] Cached data persists across reloads
- [ ] No blocking of UI during fetch
- [ ] Handles network errors gracefully
- [ ] Performance acceptable with 10+ profiles

## Known Limitations

### Token Reading Constraints
- Can only read tokens from profiles that have been launched at least once
- No way to sign in to profile without launching
- Expired tokens show error, require manual re-auth

### API Rate Limits
- Cursor API may rate-limit if too many profiles
- Recommend max 5-10 profiles
- Background refresh should not exceed 1 req/min per profile

### Cache Invalidation
- 5-minute cache may show stale data
- Manual refresh available via command
- Consider adding "Last updated" timestamp in UI

## Troubleshooting

### Quota shows "No tokens"
- Profile needs to be launched at least once
- Launch profile and sign in
- Refresh Accounts panel

### Quota shows stale data
- Wait for next background refresh
- Or run "Cursor Accounts: Refresh All Profiles" command
- Check cache validity period (5 min default)

### Performance slow
- Too many profiles configured
- Network latency high
- Increase refresh interval
- Consider removing unused profiles

## Next Phase

Proceed to **Phase 5: Instance Detection**, which adds:
- Detect running Cursor instances via process inspection
- Match PIDs to profile directories
- Visual indicators (green dot) for active profiles
- Auto-refresh when instances start/stop

## References

- [Node.js child_process](https://nodejs.org/api/child_process.html)
- [Promise.allSettled](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled)
- [VS Code GlobalState](https://code.visualstudio.com/api/references/vscode-api#Memento)
