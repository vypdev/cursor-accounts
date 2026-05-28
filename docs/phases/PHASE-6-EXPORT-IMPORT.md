# Phase 6: Export/Import

## Overview

Phase 6 adds the ability to export profile configurations to portable JSON files and import them on other machines or share with team members. This enables backup/restore workflows, team standardization, and easy migration between development machines.

## Goals

- Export profile metadata to JSON format
- Include VS Code settings.json from profile (optional)
- Import profiles from exported JSON files
- Validate imported data for correctness
- Handle conflicts (duplicate emails, existing profiles)
- Provide UI for export/import in Accounts panel
- Support bulk export (multiple profiles at once)
- Enable team sharing workflows

## Prerequisites

- Phase 1-5 completed and tested
- Profile infrastructure working correctly
- Accounts panel rendering profiles
- Understanding of JSON serialization and file I/O

## Files to Create

```
src/
├── profiles/
│   ├── profileExporter.ts           # NEW: Export profiles
│   └── profileImporter.ts           # NEW: Import profiles
└── test/
    ├── profileExporter.test.ts      # NEW: Unit tests
    └── profileImporter.test.ts      # NEW: Unit tests
```

## Files to Modify

```
src/
├── ui/accountsPanel.ts               # MODIFY: Add export/import handlers
├── profiles/types.ts                 # MODIFY: Add export types
├── commands/profileCommands.ts       # MODIFY: Add commands

webview/src/
├── components/ProfileList.tsx        # MODIFY: Add export button
├── components/ImportDialog.tsx       # NEW: Import UI
└── App.tsx                          # MODIFY: Handle import/export
```

## Implementation Details

### 1. Export Types (`src/profiles/types.ts` additions)

```typescript
/**
 * Exported profile format (portable, no absolute paths).
 */
export interface ExportedProfile {
  email: string;
  displayName: string;
  theme?: string;
  color?: string;
  settings?: Record<string, unknown>;  // VS Code settings.json
  metadata?: ProfileMetadata;
}

/**
 * Root export file format.
 */
export interface ProfileExport {
  version: string;                     // Export format version
  exportedAt: string;                  // ISO 8601 timestamp
  exportedBy?: string;                 // Machine/user identifier
  profiles: ExportedProfile[];
}

/**
 * Import options.
 */
export interface ImportOptions {
  /** Skip profiles with duplicate emails */
  skipDuplicates: boolean;
  
  /** Overwrite existing profiles with same email */
  overwriteExisting: boolean;
  
  /** Import settings.json if present */
  importSettings: boolean;
  
  /** Validate imported data strictly */
  strictValidation: boolean;
}

/**
 * Import result.
 */
export interface ImportResult {
  success: boolean;
  imported: Profile[];                 // Successfully imported
  skipped: ExportedProfile[];          // Skipped (duplicates)
  errors: Array<{
    profile: ExportedProfile;
    error: string;
  }>;
}

// Add to FromWebviewMessage union
export type FromWebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'launch'; profileId: string }
  | { type: 'add'; email: string; displayName?: string; theme?: string; color?: string }
  | { type: 'edit'; profileId: string; updates: Partial<Profile> }
  | { type: 'delete'; profileId: string }
  | { type: 'showInExplorer'; profileId: string }
  | { type: 'export'; profileIds: string[]; includeSettings: boolean }  // NEW
  | { type: 'import'; data: string; options: ImportOptions };            // NEW
```

### 2. Profile Exporter (`src/profiles/profileExporter.ts`)

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ProfileManager } from './profileManager';
import {
  Profile,
  ExportedProfile,
  ProfileExport,
} from './types';

export class ProfileExporterError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'ProfileExporterError';
  }
}

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
    const toExport = profiles.filter(p => profileIds.includes(p.id));

    if (toExport.length === 0) {
      throw new ProfileExporterError('No profiles selected for export');
    }

    const exportedProfiles: ExportedProfile[] = [];

    for (const profile of toExport) {
      const exported: ExportedProfile = {
        email: profile.email,
        displayName: profile.displayName,
        theme: profile.theme,
        color: profile.color,
        metadata: profile.metadata,
      };

      // Include settings if requested
      if (includeSettings) {
        try {
          const settings = await this.readProfileSettings(profile.userDataDir);
          if (settings) {
            exported.settings = settings;
          }
        } catch (error) {
          console.warn(`Failed to read settings for ${profile.email}:`, error);
        }
      }

      exportedProfiles.push(exported);
    }

    const exportData: ProfileExport = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      exportedBy: `${os.hostname()}`,
      profiles: exportedProfiles,
    };

    return exportData;
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
    const profileIds = profiles.map(p => p.id);
    
    await this.exportToFile(profileIds, filePath, includeSettings);
  }

  /**
   * Read settings.json from a profile's user data directory.
   */
  private async readProfileSettings(
    userDataDir: string
  ): Promise<Record<string, unknown> | null> {
    try {
      const settingsPath = path.join(userDataDir, 'User', 'settings.json');
      const content = await fs.readFile(settingsPath, 'utf-8');
      
      // Remove comments (VS Code settings.json allows comments)
      const jsonContent = this.stripJsonComments(content);
      
      return JSON.parse(jsonContent) as Record<string, unknown>;
    } catch (error) {
      // Settings file may not exist if profile never launched
      return null;
    }
  }

  /**
   * Strip comments from JSON (basic implementation).
   */
  private stripJsonComments(json: string): string {
    // Remove single-line comments
    let result = json.replace(/\/\/.*$/gm, '');
    
    // Remove multi-line comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');
    
    return result;
  }

  /**
   * Validate export data format.
   */
  static validateExport(data: unknown): data is ProfileExport {
    if (typeof data !== 'object' || data === null) {
      return false;
    }

    const obj = data as any;

    // Check required fields
    if (typeof obj.version !== 'string') return false;
    if (typeof obj.exportedAt !== 'string') return false;
    if (!Array.isArray(obj.profiles)) return false;

    // Validate each profile
    for (const profile of obj.profiles) {
      if (typeof profile.email !== 'string') return false;
      if (typeof profile.displayName !== 'string') return false;
    }

    return true;
  }
}
```

### 3. Profile Importer (`src/profiles/profileImporter.ts`)

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { ProfileManager } from './profileManager';
import { ProfileExporter } from './profileExporter';
import {
  Profile,
  ExportedProfile,
  ProfileExport,
  ImportOptions,
  ImportResult,
} from './types';

const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  skipDuplicates: true,
  overwriteExisting: false,
  importSettings: false,
  strictValidation: true,
};

export class ProfileImporterError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'ProfileImporterError';
  }
}

export class ProfileImporter {
  constructor(private readonly profileManager: ProfileManager) {}

  /**
   * Import profiles from JSON data.
   */
  async importProfiles(
    exportData: ProfileExport,
    options: Partial<ImportOptions> = {}
  ): Promise<ImportResult> {
    const opts = { ...DEFAULT_IMPORT_OPTIONS, ...options };

    // Validate import data
    if (opts.strictValidation && !ProfileExporter.validateExport(exportData)) {
      throw new ProfileImporterError('Invalid export data format');
    }

    // Version compatibility check
    const currentVersion = '1.0.0';
    if (exportData.version !== currentVersion) {
      // Attempt migration
      const migrated = this.migrateExportFormat(exportData, currentVersion);
      if (!migrated) {
        throw new ProfileImporterError(
          `Incompatible export version ${exportData.version}. ` +
          `Current version: ${currentVersion}. Migration not available. ` +
          `Please export/import using the same extension version.`
        );
      }
      exportData = migrated;
    }

    const result: ImportResult = {
      success: false,
      imported: [],
      skipped: [],
      errors: [],
    };

    // Get existing profiles
    const existing = await this.profileManager.getProfiles();
    const existingEmails = new Set(existing.map(p => p.email.toLowerCase()));

    for (const exported of exportData.profiles) {
      try {
        const emailLower = exported.email.toLowerCase();

        // Check for duplicate
        if (existingEmails.has(emailLower)) {
          if (opts.skipDuplicates && !opts.overwriteExisting) {
            result.skipped.push(exported);
            continue;
          }

          if (opts.overwriteExisting) {
            // Update existing profile
            const existingProfile = existing.find(
              p => p.email.toLowerCase() === emailLower
            );
            if (existingProfile) {
              await this.updateProfileFromExport(existingProfile, exported, opts);
              result.imported.push(existingProfile);
            }
            continue;
          }
        }

        // Create new profile
        const profile = await this.profileManager.createProfile({
          email: exported.email,
          displayName: exported.displayName,
          theme: exported.theme,
          color: exported.color,
          notes: exported.metadata?.notes,
          tags: exported.metadata?.tags,
        });

        // Import settings if requested and available
        if (opts.importSettings && exported.settings) {
          await this.writeProfileSettings(profile.userDataDir, exported.settings);
        }

        result.imported.push(profile);
      } catch (error) {
        result.errors.push({
          profile: exported,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    result.success = result.errors.length === 0;
    return result;
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
      throw new ProfileImporterError(
        'Failed to parse import data',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Update existing profile from exported data.
   */
  private async updateProfileFromExport(
    profile: Profile,
    exported: ExportedProfile,
    options: ImportOptions
  ): Promise<void> {
    await this.profileManager.updateProfile(profile.id, {
      displayName: exported.displayName,
      theme: exported.theme,
      color: exported.color,
      metadata: exported.metadata,
    });

    // Import settings if requested
    if (options.importSettings && exported.settings) {
      await this.writeProfileSettings(profile.userDataDir, exported.settings);
    }
  }

  /**
   * Write settings.json to a profile's user data directory.
   */
  private async writeProfileSettings(
    userDataDir: string,
    settings: Record<string, unknown>
  ): Promise<void> {
    try {
      // Ensure User directory exists
      const userDir = path.join(userDataDir, 'User');
      await fs.mkdir(userDir, { recursive: true });

      const settingsPath = path.join(userDir, 'settings.json');
      const json = JSON.stringify(settings, null, 2);
      
      await fs.writeFile(settingsPath, json, 'utf-8');
    } catch (error) {
      console.warn('Failed to write settings.json:', error);
    }
  }

  /**
   * Migrate export data to target version.
   * 
   * **Version Migration Strategy**:
   * - Returns migrated data if migration is possible
   * - Returns null if migration is not available
   * - Future versions should add migration logic here
   * 
   * @param data Export data to migrate
   * @param targetVersion Version to migrate to
   * @returns Migrated data or null if incompatible
   */
  private migrateExportFormat(
    data: ProfileExport,
    targetVersion: string
  ): ProfileExport | null {
    // For now, only support exact version match
    // Future: Implement version-specific migrations
    
    // Example migration (future):
    // if (data.version === '0.9.0' && targetVersion === '1.0.0') {
    //   return {
    //     ...data,
    //     version: '1.0.0',
    //     profiles: data.profiles.map(p => ({
    //       ...p,
    //       // Add new required fields with defaults
    //     }))
    //   };
    // }
    
    // Only accept exact version match for now
    return data.version === targetVersion ? data : null;
  }

  /**
   * Validate export data before import.
   */
  async validateImport(exportData: ProfileExport): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check format
    if (!ProfileExporter.validateExport(exportData)) {
      errors.push('Invalid export file format');
      return { valid: false, errors, warnings };
    }

    // Check version compatibility
    if (exportData.version !== '1.0.0') {
      warnings.push(`Export version ${exportData.version} may not be fully compatible`);
    }

    // Check for duplicates
    const existing = await this.profileManager.getProfiles();
    const existingEmails = new Set(existing.map(p => p.email.toLowerCase()));

    let duplicateCount = 0;
    for (const profile of exportData.profiles) {
      if (existingEmails.has(profile.email.toLowerCase())) {
        duplicateCount++;
      }

      // Validate email format
      const validation = this.profileManager.validateEmail(profile.email);
      if (!validation.valid) {
        errors.push(`Invalid email: ${profile.email}`);
      }
    }

    if (duplicateCount > 0) {
      warnings.push(`${duplicateCount} profile(s) already exist and will be skipped`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
```

### 4. Commands (`src/commands/profileCommands.ts` additions)

```typescript
// Add export command
context.subscriptions.push(
  vscode.commands.registerCommand('cursorQuota.exportProfiles', async () => {
    try {
      const profiles = await profileManager.getProfiles();

      if (profiles.length === 0) {
        vscode.window.showInformationMessage('No profiles to export.');
        return;
      }

      // Select profiles to export
      const selected = await vscode.window.showQuickPick(
        [
          { label: 'Export All Profiles', id: 'all' },
          ...profiles.map(p => ({
            label: p.displayName,
            description: p.email,
            id: p.id,
            picked: true,
          })),
        ],
        {
          placeHolder: 'Select profiles to export',
          canPickMany: true,
        }
      );

      if (!selected || selected.length === 0) {
        return;
      }

      // Check if "Export All" was selected
      const exportAll = selected.some(s => s.id === 'all');
      const profileIds = exportAll
        ? profiles.map(p => p.id)
        : selected.filter(s => s.id !== 'all').map(s => s.id);

      // Ask if settings should be included
      const includeSettings = await vscode.window.showQuickPick(
        ['Yes', 'No'],
        { placeHolder: 'Include VS Code settings.json?' }
      );

      // Choose export location
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(os.homedir(), 'Downloads', 'cursor-profiles-export.json')
        ),
        filters: { 'JSON': ['json'] },
      });

      if (!uri) {
        return;
      }

      // Export
      const exporter = new ProfileExporter(profileManager);
      await exporter.exportToFile(
        profileIds,
        uri.fsPath,
        includeSettings === 'Yes'
      );

      vscode.window.showInformationMessage(
        `Exported ${profileIds.length} profile(s) to ${uri.fsPath}`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to export profiles: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  })
);

// Add import command
context.subscriptions.push(
  vscode.commands.registerCommand('cursorQuota.importProfiles', async () => {
    try {
      // Choose import file
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'JSON': ['json'] },
        openLabel: 'Import',
      });

      if (!uris || uris.length === 0) {
        return;
      }

      const importer = new ProfileImporter(profileManager);
      
      // Validate first
      const content = await fs.readFile(uris[0].fsPath, 'utf-8');
      const exportData = JSON.parse(content) as ProfileExport;
      const validation = await importer.validateImport(exportData);

      if (!validation.valid) {
        vscode.window.showErrorMessage(
          `Invalid import file: ${validation.errors.join(', ')}`
        );
        return;
      }

      if (validation.warnings.length > 0) {
        const proceed = await vscode.window.showWarningMessage(
          `Warnings:\n${validation.warnings.join('\n')}\n\nContinue?`,
          { modal: true },
          'Continue'
        );
        if (proceed !== 'Continue') {
          return;
        }
      }

      // Import
      const result = await importer.importFromFile(uris[0].fsPath);

      // Show results
      const messages = [];
      if (result.imported.length > 0) {
        messages.push(`Imported: ${result.imported.length}`);
      }
      if (result.skipped.length > 0) {
        messages.push(`Skipped: ${result.skipped.length}`);
      }
      if (result.errors.length > 0) {
        messages.push(`Errors: ${result.errors.length}`);
      }

      if (result.success) {
        vscode.window.showInformationMessage(messages.join(', '));
      } else {
        vscode.window.showWarningMessage(messages.join(', '));
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to import profiles: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  })
);
```

### 5. Accounts Panel Integration (`src/ui/accountsPanel.ts`)

Add handlers for export/import:

```typescript
private async handleMessage(message: FromWebviewMessage): Promise<void> {
  try {
    switch (message.type) {
      // ...existing cases

      case 'export':
        await this.handleExport(message.profileIds, message.includeSettings);
        break;

      case 'import':
        await this.handleImport(message.data, message.options);
        break;
    }
  } catch (error) {
    await this.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

private async handleExport(
  profileIds: string[],
  includeSettings: boolean
): Promise<void> {
  const exporter = new ProfileExporter(this.profileManager);
  const exportData = await exporter.exportProfiles(profileIds, includeSettings);
  
  // Convert to JSON string
  const json = JSON.stringify(exportData, null, 2);
  
  // Trigger download in webview (via data URI)
  await this.postMessage({
    type: 'success',
    message: 'Export ready. Download will start automatically.',
  });
  
  // Note: Actual download trigger would be handled by webview
  // Extension can't directly trigger file download in webview
  // Instead, return data and let webview create download link
}

private async handleImport(
  json: string,
  options: ImportOptions
): Promise<void> {
  const importer = new ProfileImporter(this.profileManager);
  const result = await importer.importFromString(json, options);
  
  if (result.success) {
    await this.postMessage({
      type: 'success',
      message: `Imported ${result.imported.length} profile(s)`,
    });
    await this.refresh();
  } else {
    await this.postMessage({
      type: 'error',
      message: `Import completed with errors: ${result.errors.length}`,
    });
  }
}
```

### 6. Webview UI Components

#### Import Dialog (`webview/src/components/ImportDialog.tsx`)

```typescript
import React, { useState, useRef } from 'react';
import { ImportOptions } from '../types';

interface ImportDialogProps {
  onImport: (json: string, options: ImportOptions) => void;
  onCancel: () => void;
}

export const ImportDialog: React.FC<ImportDialogProps> = ({
  onImport,
  onCancel,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [importSettings, setImportSettings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      
      onImport(text, {
        skipDuplicates,
        overwriteExisting: !skipDuplicates,
        importSettings,
        strictValidation: true,
      });
    } catch (error) {
      console.error('Failed to read file:', error);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Import Profiles</h3>
          <button className="btn-close" onClick={onCancel}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="file">Select export file</label>
            <input
              ref={fileInputRef}
              id="file"
              type="file"
              accept=".json"
              onChange={handleFileChange}
            />
            {file && <span className="file-name">{file.name}</span>}
          </div>

          <div className="form-group checkbox">
            <label>
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={(e) => setSkipDuplicates(e.target.checked)}
              />
              Skip duplicate profiles
            </label>
          </div>

          <div className="form-group checkbox">
            <label>
              <input
                type="checkbox"
                checked={importSettings}
                onChange={(e) => setImportSettings(e.target.checked)}
              />
              Import VS Code settings
            </label>
          </div>

          <div className="form-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!file}>
              Import
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
```

#### Profile List Updates (`webview/src/components/ProfileList.tsx`)

Add export button:

```typescript
<div className="list-header">
  <button onClick={() => onExport(profiles.map(p => p.id))}>
    Export All
  </button>
</div>
```

### 7. Package.json Updates

```json
{
  "contributes": {
    "commands": [
      {
        "command": "cursorQuota.exportProfiles",
        "title": "Cursor Quota: Export Profiles",
        "icon": "$(export)"
      },
      {
        "command": "cursorQuota.importProfiles",
        "title": "Cursor Quota: Import Profiles",
        "icon": "$(folder-opened)"
      }
    ]
  }
}
```

## User Workflows

### Exporting Profiles

1. User opens Command Palette
2. Types "Cursor Quota: Export Profiles"
3. Selects which profiles to export (or "Export All")
4. Chooses whether to include settings.json
5. Selects save location
6. File saved as JSON

### Importing Profiles

1. User opens Command Palette
2. Types "Cursor Quota: Import Profiles"
3. Selects import file
4. Extension validates and shows warnings if duplicates
5. User confirms import
6. Profiles created and settings applied

### Team Sharing

1. Team lead exports standard profiles with settings
2. Shares JSON file via Git repo or shared drive
3. Team members import profiles
4. Everyone has consistent setup

## Testing Strategy

### Unit Tests
```bash
pnpm test
```

### Manual Testing

1. **Export single profile** with settings
2. **Import on same machine** (should show duplicates)
3. **Import on different machine** (should create new)
4. **Export/import round-trip** (verify data integrity)
5. **Test with corrupted JSON** (verify error handling)

## Acceptance Criteria

- [ ] Can export single profile to JSON
- [ ] Can export multiple profiles
- [ ] Can export with/without settings.json
- [ ] Can import profiles from JSON file
- [ ] Duplicate detection works correctly
- [ ] Settings imported correctly
- [ ] Validation catches malformed data
- [ ] Error messages helpful
- [ ] Export/import commands in Command Palette
- [ ] UI buttons in Accounts panel

## Known Limitations

### Settings Portability
- Absolute paths in settings.json won't work on other machines
- Extension settings may reference local extensions
- Recommend manual review after import

### Version Compatibility
- **Current version**: 1.0.0 exports only
- **Migration support**: Not yet implemented (exact version match required)
- **Incompatibility handling**: Import fails with clear error message if versions don't match
- **Future enhancement**: Migration logic in `ProfileImporter.migrateExportFormat()` for backwards compatibility
- **Recommendation**: Always export/import using the same extension version for guaranteed compatibility
- **Breaking changes**: If export format changes in future, implement migration or bump major version

### Security
- No encryption of exported data
- Tokens not included (security by design)
- Sensitive settings visible in export file

## Troubleshooting

### Import fails with "Invalid format"
- Check JSON syntax
- Verify export version matches
- Try strict validation off

### Settings not applying
- Check user data directory created
- Verify settings.json written correctly
- May need to restart Cursor

### Duplicate profiles created
- Enable "Skip duplicates" option
- Or use "Overwrite existing"
- Check email matching (case-insensitive)

## Future Enhancements

- Encrypted exports (password-protected)
- Selective setting import (choose which settings)
- Cloud sync (optional, via user's storage)
- Template profiles (pre-configured setups)
- Bulk update from template

## References

- [JSON.stringify](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)
- [File System Promises API](https://nodejs.org/api/fs.html#promises-api)
- [VS Code showSaveDialog](https://code.visualstudio.com/api/references/vscode-api#window.showSaveDialog)
