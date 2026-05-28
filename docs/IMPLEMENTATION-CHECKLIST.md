# Implementation Checklist

Critical considerations for each phase based on documentation review findings.

---

## Before Starting Any Phase

### Required Knowledge
- [ ] Read main feature spec: `FEATURE-MULTI-PROFILE.md`
- [ ] Review phase dependencies diagram
- [ ] Understand error recovery strategy ("best effort" approach)
- [ ] Review terminology standards (Profile vs Account)

### Environment Setup
- [ ] Node.js 22+ installed
- [ ] TypeScript 5.5+ configured
- [ ] VS Code Extension API knowledge refreshed
- [ ] Test environment with multiple Cursor accounts available

---

## Phase 1: Profile Infrastructure

### Critical Requirements
- [ ] **Use `pathUtils.ts` for ALL path operations** - no direct `path.normalize()` calls
- [ ] **Implement automatic slug collision resolution** - append hash when needed
- [ ] **Validate user data paths** - use `validateUserDataPath()` before creating profiles
- [ ] **Import** `generateUniqueSlug` with `includeHash` parameter

### Code Locations
```typescript
// MUST USE:
import { normalizePath, pathsEqual, validateUserDataPath } from '../utils/pathUtils';
import { generateUniqueSlug } from '../utils/emailToSlug';

// IN createProfile():
if (existingPath) {
  const uniqueSlug = generateUniqueSlug(options.email, true);  // ← true enables hash
  // ...
}

// IN findProfileByPath():
return config.profiles.find(p => pathsEqual(p.userDataDir, userDataDir));  // ← NOT path.normalize()

// IN isProfilePathValid():
const validation = validateUserDataPath(userDataDir);  // ← Security validation
```

### Testing Focus
- [ ] Test slug collision scenario (`user@example.com` vs `user_example@com`)
- [ ] Test path validation rejects system directories
- [ ] Test path comparison on Windows (case-insensitive)
- [ ] Test path comparison on macOS/Linux (case-sensitive)

### Common Pitfalls
- ❌ Don't use `path.normalize()` directly for comparison
- ❌ Don't ignore slug collisions - must handle automatically
- ❌ Don't skip path validation - security risk

---

## Phase 2: Profile Launcher + Detector

### Critical Requirements
- [ ] **ProfileDetector MUST receive context** - required for `globalStorageUri` detection
- [ ] **Use VS Code API for detection** - `context.globalStorageUri.fsPath` as primary method
- [ ] **Navigate up 3 levels** from globalStorageUri to get user data dir
- [ ] **Fallback chain implemented** with console warnings

### Code Locations
```typescript
// Constructor MUST include context:
constructor(
  private readonly profileManager: ProfileManager,
  private readonly context: vscode.ExtensionContext  // ← REQUIRED
) {}

// Detection order:
// 1. context.globalStorageUri.fsPath (PREFERRED)
// 2. process.env.VSCODE_USER_DATA_DIR (fallback with warning)
// 3. process.argv (fallback with warning)
// 4. default location (fallback with warning)

// In extension.ts:
const profileDetector = new ProfileDetector(profileManager, context);  // ← Pass context
```

### Testing Focus
- [ ] **Integration test required** - must run in Extension Development Host
- [ ] Test with default Cursor installation (no --user-data-dir)
- [ ] Test with custom --user-data-dir flag
- [ ] Verify globalStorageUri path parsing on all platforms
- [ ] Test fallback behavior when API unavailable

### Common Pitfalls
- ❌ Don't rely only on environment variables or process.argv
- ❌ Don't forget to pass context in constructor
- ❌ Don't skip integration testing - unit tests aren't enough

---

## Phase 3: Accounts Panel

### Critical Requirements
- [ ] **Message protocol type-safe** - use discriminated unions
- [ ] **Webview CSP configured** - restrict script sources
- [ ] **State persistence versioned** - include schema version in saved state

### Code Locations
```typescript
// Message types MUST be discriminated unions:
type ToWebviewMessage =
  | { type: 'init'; data: InitData }
  | { type: 'error'; message: string }
  // ... all messages MUST have type field

// CSP in HTML:
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
```

### Testing Focus
- [ ] Test message passing both directions
- [ ] Test webview reload (state should persist if implemented)
- [ ] Test with no profiles (empty state)
- [ ] Test with 10+ profiles (performance)

### Common Pitfalls
- ❌ Don't use `any` for message types
- ❌ Don't skip CSP configuration
- ❌ Don't block UI during data fetching

---

## Phase 4: Multi-Profile Monitoring

### Critical Requirements - REFACTORING NEEDED
- [ ] **MUST refactor `readAuthFromStateDb`** before implementing Phase 4
- [ ] **New signature required**: `readAuthFromStateDb(stateDbPath: string): Promise<AuthTokens | null>`
- [ ] **TokenService architecture decision** - choose Option A or B (see docs)
- [ ] **Security validation** - verify paths before reading state.vscdb

### Existing Code Changes Required

#### 1. Update `src/auth/tokenReader.ts`
```typescript
// OLD (assumed):
function readAuthFromStateDb(extensionPath: string): AuthTokens | null

// NEW (required):
async function readAuthFromStateDb(stateDbPath: string): Promise<AuthTokens | null> {
  // Accept full path to state.vscdb file
  // Validate path is within home directory (security)
  // Read and parse SQLite database
  // Return tokens or null
}
```

#### 2. Update `src/auth/tokenRefresh.ts` (TokenService)
Choose one approach:

**Option A: Accept pre-loaded tokens**
```typescript
class TokenService {
  constructor(
    context: vscode.ExtensionContext,
    preloadedTokens?: AuthTokens  // NEW parameter
  ) {
    // Use preloadedTokens if provided, else read from context
  }
}
```

**Option B: Create subclass** (better separation)
```typescript
class ProfileTokenService extends TokenService {
  constructor(
    context: vscode.ExtensionContext,
    profileTokens: AuthTokens,
    profileUserDataDir: string
  ) {
    // Use provided tokens for this specific profile
  }
}
```

#### 3. Security Validation Required
```typescript
// Before reading from profile directory:
const validation = validateUserDataPath(profile.userDataDir);
if (!validation.valid) {
  throw new Error(`Invalid profile path: ${validation.error}`);
}

// Construct safe path:
const stateDbPath = path.join(profile.userDataDir, 'User', 'globalStorage', 'state.vscdb');

// Verify file is readable:
try {
  await fs.access(stateDbPath, fs.constants.R_OK);
} catch {
  return null;  // File doesn't exist or not readable
}
```

### Testing Focus
- [ ] Test quota fetching for multiple profiles in parallel
- [ ] Test with expired tokens (should show "authentication required")
- [ ] Test with missing state.vscdb (new profile never launched)
- [ ] Test partial failures (2 of 5 profiles succeed)
- [ ] Test "Sign In" button triggers profile launch

### Common Pitfalls
- ❌ Don't skip refactoring existing code - Phase 4 won't work without it
- ❌ Don't read from wrong directory - use profile's userDataDir, not current context
- ❌ Don't skip path validation - security vulnerability
- ❌ Don't throw on individual failures - use Promise.allSettled

---

## Phase 5: Instance Detection

### Critical Requirements
- [ ] **PowerShell primary method on Windows** - wmic is deprecated
- [ ] **Helper process filtering** - exclude processes with "Helper" or "--type="
- [ ] **Timeout protection** - 5 second timeout on all process commands
- [ ] **Comprehensive error handling** - log but don't crash on parse errors
- [ ] **Validation tests with fixtures** - test with known process outputs

### Code Locations
```typescript
// Windows detection order:
// 1. PowerShell with JSON output (PREFERRED)
// 2. wmic fallback (deprecated, for older Windows)

// Helper process filtering (ALL platforms):
if (command.includes('Helper') || command.includes('--type=')) {
  continue;  // Skip helper processes
}

// Timeout protection:
const { stdout } = await execAsync(command, { timeout: 5000 });

// Error handling - continue on individual failures:
try {
  // Parse line/block
} catch (lineError) {
  console.error('Error parsing line:', line, lineError);
  continue;  // Don't fail entire detection
}
```

### Testing Focus - VALIDATION TESTS REQUIRED
- [ ] Create test fixtures directory: `src/test/fixtures/process-outputs/`
- [ ] Add `macos-ps-output.txt` with sample ps output
- [ ] Add `windows-powershell-output.json` with sample JSON
- [ ] Add `linux-ps-output.txt` with sample ps output
- [ ] Test parsing with known good outputs
- [ ] Test parsing with malformed outputs (should log, not crash)
- [ ] Test helper process filtering (main process detected, helpers ignored)

### Common Pitfalls
- ❌ Don't use only wmic on Windows - use PowerShell first
- ❌ Don't fail on individual parse errors - continue processing
- ❌ Don't skip helper filtering - will detect wrong processes
- ❌ Don't skip validation tests - parsing WILL break on OS updates

---

## Phase 6: Export/Import

### Critical Requirements
- [ ] **Best effort import** - don't rollback partial successes
- [ ] **Version compatibility checks** - warn on version mismatch
- [ ] **Settings.json optional** - user chooses to include or not

### Code Locations
```typescript
// Import continues despite individual failures:
for (const exported of exportData.profiles) {
  try {
    const profile = await profileManager.createProfile(exported);
    result.imported.push(profile);
  } catch (error) {
    result.errors.push({ profile: exported, error: error.message });
    // Continue to next profile - DON'T throw or rollback
  }
}

// Return detailed result:
return {
  success: result.errors.length === 0,
  imported: [...],
  skipped: [...],
  errors: [...]
};
```

### Testing Focus
- [ ] Test export with settings.json
- [ ] Test export without settings.json
- [ ] Test import with duplicates (should skip)
- [ ] Test import with errors (should report but continue)
- [ ] Test round-trip (export then import)

### Common Pitfalls
- ❌ Don't roll back on first error - accumulate errors and continue
- ❌ Don't export tokens - metadata only
- ❌ Don't skip version compatibility check

---

## Cross-Phase Requirements

### Path Handling (ALL phases)
```typescript
// ALWAYS use pathUtils:
import { normalizePath, pathsEqual, validateUserDataPath } from '../utils/pathUtils';

// For comparison:
if (pathsEqual(path1, path2)) { ... }  // ✅ Correct

// NEVER do this:
if (path.normalize(path1) === path.normalize(path2)) { ... }  // ❌ Wrong
```

### Error Handling (ALL phases)
```typescript
// Multi-item operations:
const results = await Promise.allSettled(items.map(process));  // ✅ Continue despite failures

// Single critical operation:
try {
  await criticalOperation();
} catch (error) {
  await rollback();  // Only if atomicity required
  throw error;
}
```

### User Communication (ALL phases)
```typescript
// Error messages MUST be:
// 1. Specific
vscode.window.showErrorMessage(
  `Failed to fetch quota for Work profile: Network timeout`  // ✅ Specific
);

// NOT:
vscode.window.showErrorMessage(`Error fetching quotas`);  // ❌ Vague

// 2. Actionable
vscode.window.showErrorMessage(
  `Cursor executable not found at /Applications/Cursor.app. Please install Cursor.`,  // ✅ Actionable
  'Install Cursor'  // Action button
);
```

---

## Integration Testing Requirements

### Phase 2: Profile Detection
```typescript
// MUST run in Extension Development Host (F5)
describe('ProfileDetector Integration', () => {
  it('should detect profile from globalStorageUri', async () => {
    const context = vscode.extensions.getExtension('your.extension')?.extensionContext;
    const detector = new ProfileDetector(manager, context);
    const userDataDir = detector.getCurrentUserDataDir();
    
    assert.ok(path.isAbsolute(userDataDir));
    // Verify expected structure exists
  });
});
```

### Phase 5: Instance Detection
```typescript
// Test with actual Cursor processes
describe('InstanceDetector Integration', () => {
  it('should detect currently running instance', async () => {
    const detector = new InstanceDetector(profileManager);
    const instances = await detector.detectRunningInstances();
    
    // If test runs in Cursor, should detect at least current instance
    assert.ok(instances.size >= 0);
  });
});
```

---

## Performance Requirements

### Phase 4: Quota Fetching
- [ ] Fetching 5 profiles should complete in < 5 seconds
- [ ] Use `Promise.allSettled` for parallel requests
- [ ] Timeout individual requests at 15 seconds
- [ ] Cache results for 5 minutes

### Phase 5: Instance Detection
- [ ] Detection should complete in < 1 second
- [ ] Poll every 30 seconds (configurable)
- [ ] Minimal CPU impact (~10-50ms per poll)

### Phase 3: Webview
- [ ] Virtualize list if > 20 profiles
- [ ] Lazy-load quota data (show profiles first)
- [ ] Throttle message passing

---

## Security Checklist

### Path Validation
- [ ] **ALWAYS validate** before reading from or writing to user data directories
- [ ] **NEVER trust** user input for paths
- [ ] **USE** `validateUserDataPath()` function

### Token Handling
- [ ] **NEVER store** tokens in config.json
- [ ] **READ-ONLY** access to state.vscdb
- [ ] **VALIDATE** paths before reading tokens

### Process Spawning
- [ ] **VALIDATE** executable paths
- [ ] **CHECK** permissions before launching
- [ ] **TIMEOUT** process operations

---

## Pre-Implementation Validation

Before starting implementation, validate assumptions:

### Existing Code
- [ ] Locate `readAuthFromStateDb` function - confirm current signature
- [ ] Locate `TokenService` class - confirm architecture
- [ ] Locate `QuotaClient` class - confirm it can accept different token sources
- [ ] Check if path normalization already exists elsewhere

### Cursor Specifics
- [ ] Test quota API rate limits with multiple rapid requests
- [ ] Investigate Cursor Settings Sync behavior
- [ ] Verify `globalStorageUri` path structure in actual Cursor

### Platform Testing
- [ ] Access to macOS, Windows, Linux for testing
- [ ] Multiple Cursor accounts available for testing
- [ ] Permissions to install/run multiple Cursor instances

---

## Quick Reference: Import Statements

### Phase 1
```typescript
import { normalizePath, pathsEqual, validateUserDataPath } from '../utils/pathUtils';
import { emailToSlug, generateUniqueSlug } from '../utils/emailToSlug';
```

### Phase 2
```typescript
import { pathsEqual } from '../utils/pathUtils';
```

### Phase 4
```typescript
import * as fs from 'fs/promises';
import * as os from 'os';
import { validateUserDataPath } from '../utils/pathUtils';
```

### Phase 5
```typescript
import { pathsEqual } from '../utils/pathUtils';
```

---

## Success Criteria

Each phase is complete when:
- [ ] All unit tests passing
- [ ] Integration tests passing (where applicable)
- [ ] Manual testing checklist completed
- [ ] Code review completed
- [ ] Documentation updated (if implementation differs from spec)
- [ ] No linter errors
- [ ] Performance requirements met

---

**Last Updated**: May 28, 2026
**Status**: Ready for implementation

