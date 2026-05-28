# Phase 3: Accounts Panel

## Overview

Phase 3 introduces a visual management interface for profiles through a webview sidebar panel. Users can view all configured profiles in a card-based UI, see their status, and perform operations (add, edit, delete, launch) through an intuitive React-based interface. This phase transforms profile management from command-palette-only to a fully visual experience.

## Goals

- Create webview sidebar panel for profile management
- Build React-based UI with modern design
- Display profile list with visual indicators (active, theme colors)
- Implement add/edit/delete workflows in UI
- Enable profile launching from UI
- Establish message passing protocol between webview and extension
- Add real-time UI updates when profiles change

## Prerequisites

- Phase 1 and Phase 2 completed and tested
- Profile Manager, Launcher, Detector working correctly
- Understanding of VS Code Webview API
- React and TypeScript knowledge
- Build tooling for webview (esbuild or similar)

## Files to Create

```
src/
├── ui/
│   └── accountsPanel.ts              # NEW: Webview provider
└── test/
    └── accountsPanel.test.ts         # NEW: Unit tests

webview/                              # NEW: React application
├── src/
│   ├── App.tsx                       # Main React app
│   ├── App.css                       # Styles
│   ├── index.tsx                     # Entry point
│   ├── components/
│   │   ├── ProfileList.tsx           # List container
│   │   ├── ProfileCard.tsx           # Individual profile card
│   │   ├── AddProfileForm.tsx        # Add profile dialog
│   │   ├── EditProfileForm.tsx       # Edit profile dialog
│   │   └── EmptyState.tsx            # No profiles state
│   ├── api/
│   │   └── vscodeApi.ts              # VS Code API wrapper
│   └── types/
│       └── index.ts                  # Shared types
├── public/
│   └── index.html                    # HTML template
├── package.json                      # Dependencies
├── tsconfig.json                     # TypeScript config
└── esbuild.config.js                 # Build config
```

## Files to Modify

```
src/
├── extension.ts                      # MODIFY: Register webview provider
└── profiles/types.ts                 # MODIFY: Add webview message types

package.json                          # MODIFY: Add view container, build scripts
```

## Implementation Details

### 1. Message Protocol Types (`src/profiles/types.ts` additions)

Define message types for extension ↔ webview communication.

```typescript
/**
 * Messages sent from extension to webview.
 */
export type ToWebviewMessage =
  | { type: 'init'; data: InitData }
  | { type: 'profiles'; data: Profile[] }
  | { type: 'currentProfile'; data: Profile | null }
  | { type: 'error'; message: string }
  | { type: 'success'; message: string };

/**
 * Messages sent from webview to extension.
 */
export type FromWebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'launch'; profileId: string }
  | { type: 'add'; email: string; displayName?: string; theme?: string; color?: string }
  | { type: 'edit'; profileId: string; updates: Partial<Profile> }
  | { type: 'delete'; profileId: string }
  | { type: 'showInExplorer'; profileId: string };

/**
 * Initial data sent when webview loads.
 */
export interface InitData {
  profiles: Profile[];
  currentProfile: Profile | null;
}
```

### 2. Accounts Panel Provider (`src/ui/accountsPanel.ts`)

Webview provider that hosts the React application.

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileLauncher } from '../profiles/profileLauncher';
import { ProfileDetector } from '../profiles/profileDetector';
import {
  ToWebviewMessage,
  FromWebviewMessage,
  InitData,
  Profile,
} from '../profiles/types';

export class AccountsPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'cursorQuota.accountsPanel';
  
  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileManager: ProfileManager,
    private readonly profileLauncher: ProfileLauncher,
    private readonly profileDetector: ProfileDetector
  ) {}

  /**
   * Called when webview becomes visible.
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    // Configure webview
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'webview-dist')),
      ],
    };

    // Set HTML content
    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(
      async (message: FromWebviewMessage) => {
        await this.handleMessage(message);
      },
      undefined,
      this.context.subscriptions
    );

    // Send initial data when webview becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.refresh();
      }
    });
  }

  /**
   * Refresh webview data.
   */
  public async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    try {
      const profiles = await this.profileManager.getProfiles();
      const currentProfile = await this.profileDetector.detectCurrentProfile();

      const initData: InitData = {
        profiles,
        currentProfile,
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

  /**
   * Handle messages from webview.
   */
  private async handleMessage(message: FromWebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          await this.refresh();
          break;

        case 'refresh':
          await this.refresh();
          break;

        case 'launch':
          await this.handleLaunch(message.profileId);
          break;

        case 'add':
          await this.handleAdd(message);
          break;

        case 'edit':
          await this.handleEdit(message.profileId, message.updates);
          break;

        case 'delete':
          await this.handleDelete(message.profileId);
          break;

        case 'showInExplorer':
          await this.handleShowInExplorer(message.profileId);
          break;

        default:
          console.warn('Unknown message type:', (message as any).type);
      }
    } catch (error) {
      await this.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Launch a profile.
   */
  private async handleLaunch(profileId: string): Promise<void> {
    const result = await this.profileLauncher.launch(profileId);
    
    if (result.success) {
      const profile = await this.profileManager.getProfile(profileId);
      await this.postMessage({
        type: 'success',
        message: `Launching ${profile?.displayName ?? 'profile'}...`,
      });
      await this.refresh();
    } else {
      await this.postMessage({
        type: 'error',
        message: result.error ?? 'Failed to launch profile',
      });
    }
  }

  /**
   * Add a new profile.
   */
  private async handleAdd(
    data: Extract<FromWebviewMessage, { type: 'add' }>
  ): Promise<void> {
    const profile = await this.profileManager.createProfile({
      email: data.email,
      displayName: data.displayName,
      theme: data.theme,
      color: data.color,
    });

    await this.postMessage({
      type: 'success',
      message: `Profile "${profile.displayName}" created`,
    });
    await this.refresh();
  }

  /**
   * Edit an existing profile.
   */
  private async handleEdit(
    profileId: string,
    updates: Partial<Profile>
  ): Promise<void> {
    const profile = await this.profileManager.updateProfile(profileId, updates);

    await this.postMessage({
      type: 'success',
      message: `Profile "${profile.displayName}" updated`,
    });
    await this.refresh();
  }

  /**
   * Delete a profile.
   */
  private async handleDelete(profileId: string): Promise<void> {
    const profile = await this.profileManager.getProfile(profileId);
    const displayName = profile?.displayName ?? 'Unknown';

    await this.profileManager.deleteProfile(profileId);

    await this.postMessage({
      type: 'success',
      message: `Profile "${displayName}" deleted`,
    });
    await this.refresh();
  }

  /**
   * Show profile directory in file explorer.
   */
  private async handleShowInExplorer(profileId: string): Promise<void> {
    const profile = await this.profileManager.getProfile(profileId);
    if (!profile) {
      throw new Error('Profile not found');
    }

    const uri = vscode.Uri.file(profile.userDataDir);
    await vscode.commands.executeCommand('revealFileInOS', uri);
  }

  /**
   * Post message to webview.
   */
  private async postMessage(message: ToWebviewMessage): Promise<void> {
    if (this.view) {
      await this.view.webview.postMessage(message);
    }
  }

  /**
   * Get HTML content for webview.
   */
  private getHtmlContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webview-dist', 'bundle.js')
      )
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webview-dist', 'bundle.css')
      )
    );

    const nonce = getNonce();

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <link rel="stylesheet" href="${styleUri}">
        <title>Cursor Accounts</title>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>
    `;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
```

### 3. React Webview Application

#### Package Configuration (`webview/package.json`)

```json
{
  "name": "cursor-quota-webview",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "node esbuild.config.js",
    "watch": "node esbuild.config.js --watch"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@types/vscode-webview": "^1.57.0",
    "esbuild": "^0.19.0",
    "typescript": "^5.5.0"
  }
}
```

#### Build Configuration (`webview/esbuild.config.js`)

```javascript
const esbuild = require('esbuild');
const path = require('path');

const isWatch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: ['src/index.tsx'],
  bundle: true,
  outfile: path.join(__dirname, '..', 'webview-dist', 'bundle.js'),
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
    '.css': 'css',
  },
  external: ['vscode'],
  sourcemap: true,
  minify: !isWatch,
};

if (isWatch) {
  esbuild.context(buildOptions).then(ctx => {
    console.log('Watching for changes...');
    ctx.watch();
  });
} else {
  esbuild.build(buildOptions).then(() => {
    console.log('Build complete!');
  }).catch(() => process.exit(1));
}
```

#### Webview Types (`webview/src/types/index.ts`)

**CRITICAL**: These types are duplicated from the extension-side types because the webview cannot import from extension code. They must be kept in sync manually.

```typescript
/**
 * Mirror of extension-side types for webview consumption.
 * 
 * **IMPORTANT**: Keep in sync with src/profiles/types.ts
 * These are duplicated because webview cannot import from extension code.
 * Any changes to extension types must be manually replicated here.
 */

export interface Profile {
  id: string;
  email: string;
  slug: string;
  displayName: string;
  userDataDir: string;
  created: string;
  lastLaunched?: string;
  theme?: string;
  color?: string;
  metadata?: {
    source?: 'manual' | 'imported' | 'detected';
    notes?: string;
    tags?: string[];
  };
}

export interface ProfileMetadata {
  source?: 'manual' | 'imported' | 'detected';
  notes?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface InitData {
  profiles: Profile[];
  currentProfile: Profile | null;
}

export type ToWebviewMessage =
  | { type: 'init'; data: InitData }
  | { type: 'profiles'; data: Profile[] }
  | { type: 'currentProfile'; data: Profile | null }
  | { type: 'error'; message: string }
  | { type: 'success'; message: string };

export type FromWebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'launch'; profileId: string }
  | { type: 'add'; email: string; displayName?: string; theme?: string; color?: string }
  | { type: 'edit'; profileId: string; updates: Partial<Profile> }
  | { type: 'delete'; profileId: string }
  | { type: 'showInExplorer'; profileId: string };
```

**Note on Type Duplication**: This creates a maintenance burden - when extension types change, webview types must be updated manually. This is a known limitation of VS Code's webview architecture. Consider documenting type changes in both locations or creating a script to validate type consistency.

#### VS Code API Wrapper (`webview/src/api/vscodeApi.ts`)

```typescript
import { ToWebviewMessage, FromWebviewMessage, Profile } from '../types';

// Get VS Code API
declare const acquireVsCodeApi: () => {
  postMessage(message: FromWebviewMessage): void;
  getState(): any;
  setState(state: any): void;
};

const vscode = acquireVsCodeApi();

type MessageHandler = (message: ToWebviewMessage) => void;

class VSCodeAPI {
  private handlers: MessageHandler[] = [];

  constructor() {
    window.addEventListener('message', (event) => {
      const message = event.data as ToWebviewMessage;
      this.handlers.forEach(handler => handler(message));
    });
  }

  /**
   * Register a message handler.
   */
  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler);
    };
  }

  /**
   * Send message to extension.
   */
  postMessage(message: FromWebviewMessage): void {
    vscode.postMessage(message);
  }

  /**
   * Notify extension that webview is ready.
   */
  ready(): void {
    this.postMessage({ type: 'ready' });
  }

  /**
   * Request refresh of data.
   */
  refresh(): void {
    this.postMessage({ type: 'refresh' });
  }

  /**
   * Launch a profile.
   */
  launch(profileId: string): void {
    this.postMessage({ type: 'launch', profileId });
  }

  /**
   * Add a new profile.
   */
  addProfile(email: string, displayName?: string, theme?: string, color?: string): void {
    this.postMessage({ type: 'add', email, displayName, theme, color });
  }

  /**
   * Edit a profile.
   */
  editProfile(profileId: string, updates: Partial<Profile>): void {
    this.postMessage({ type: 'edit', profileId, updates });
  }

  /**
   * Delete a profile.
   */
  deleteProfile(profileId: string): void {
    this.postMessage({ type: 'delete', profileId });
  }

  /**
   * Show profile directory in file explorer.
   */
  showInExplorer(profileId: string): void {
    this.postMessage({ type: 'showInExplorer', profileId });
  }

  /**
   * Save state (persists across reloads).
   */
  saveState(state: any): void {
    vscode.setState(state);
  }

  /**
   * Get saved state.
   */
  getState(): any {
    return vscode.getState();
  }
}

export const vscodeApi = new VSCodeAPI();
```

#### Main App Component (`webview/src/App.tsx`)

```typescript
import React, { useEffect, useState, useCallback } from 'react';
import { vscodeApi } from './api/vscodeApi';
import { Profile, InitData, ToWebviewMessage } from './types';
import { ProfileList } from './components/ProfileList';
import { AddProfileForm } from './components/AddProfileForm';
import { EmptyState } from './components/EmptyState';
import './App.css';

export const App: React.FC = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Handle messages from extension
  useEffect(() => {
    const unsubscribe = vscodeApi.onMessage((message: ToWebviewMessage) => {
      switch (message.type) {
        case 'init':
          setProfiles(message.data.profiles);
          setCurrentProfile(message.data.currentProfile);
          setLoading(false);
          break;

        case 'profiles':
          setProfiles(message.data);
          break;

        case 'currentProfile':
          setCurrentProfile(message.data);
          break;

        case 'error':
          setError(message.message);
          setTimeout(() => setError(null), 5000);
          break;

        case 'success':
          // Show success toast (could be enhanced with a toast library)
          console.log('Success:', message.message);
          break;
      }
    });

    // Notify extension that webview is ready
    vscodeApi.ready();

    return unsubscribe;
  }, []);

  const handleLaunch = useCallback((profileId: string) => {
    vscodeApi.launch(profileId);
  }, []);

  const handleEdit = useCallback((profileId: string, updates: Partial<Profile>) => {
    vscodeApi.editProfile(profileId, updates);
  }, []);

  const handleDelete = useCallback((profileId: string) => {
    vscodeApi.deleteProfile(profileId);
  }, []);

  const handleShowInExplorer = useCallback((profileId: string) => {
    vscodeApi.showInExplorer(profileId);
  }, []);

  const handleAddProfile = useCallback((
    email: string,
    displayName?: string,
    theme?: string,
    color?: string
  ) => {
    vscodeApi.addProfile(email, displayName, theme, color);
    setShowAddForm(false);
  }, []);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>Loading profiles...</p>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="header">
        <h2>Cursor Accounts</h2>
        <button
          className="btn-primary"
          onClick={() => setShowAddForm(true)}
          title="Add new profile"
        >
          + Add Profile
        </button>
      </div>

      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}

      {currentProfile && (
        <div className="current-profile">
          <span className="label">Current:</span>
          <span className="profile-name">{currentProfile.displayName}</span>
        </div>
      )}

      {profiles.length === 0 ? (
        <EmptyState onAddProfile={() => setShowAddForm(true)} />
      ) : (
        <ProfileList
          profiles={profiles}
          currentProfileId={currentProfile?.id}
          onLaunch={handleLaunch}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onShowInExplorer={handleShowInExplorer}
        />
      )}

      {showAddForm && (
        <AddProfileForm
          onSubmit={handleAddProfile}
          onCancel={() => setShowAddForm(false)}
        />
      )}
    </div>
  );
};
```

#### Profile Card Component (`webview/src/components/ProfileCard.tsx`)

```typescript
import React, { useState } from 'react';
import { Profile } from '../types';

interface ProfileCardProps {
  profile: Profile;
  isCurrent: boolean;
  onLaunch: (id: string) => void;
  onEdit: (id: string, updates: Partial<Profile>) => void;
  onDelete: (id: string) => void;
  onShowInExplorer: (id: string) => void;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({
  profile,
  isCurrent,
  onLaunch,
  onEdit,
  onDelete,
  onShowInExplorer,
}) => {
  const [showMenu, setShowMenu] = useState(false);

  const handleLaunch = () => {
    onLaunch(profile.id);
  };

  const handleDelete = () => {
    if (confirm(`Delete profile "${profile.displayName}"?`)) {
      onDelete(profile.id);
    }
  };

  return (
    <div
      className={`profile-card ${isCurrent ? 'current' : ''}`}
      style={{ borderLeftColor: profile.color }}
    >
      <div className="profile-header">
        <div className="profile-info">
          <h3>{profile.displayName}</h3>
          <span className="email">{profile.email}</span>
        </div>
        {isCurrent && <span className="badge">Active</span>}
      </div>

      {profile.theme && (
        <div className="profile-meta">
          <span className="theme">Theme: {profile.theme}</span>
        </div>
      )}

      <div className="profile-actions">
        <button
          className="btn-launch"
          onClick={handleLaunch}
          disabled={isCurrent}
        >
          {isCurrent ? 'Current Window' : 'Launch'}
        </button>

        <div className="menu-container">
          <button
            className="btn-menu"
            onClick={() => setShowMenu(!showMenu)}
          >
            ⋮
          </button>

          {showMenu && (
            <div className="menu">
              <button onClick={() => onShowInExplorer(profile.id)}>
                Show in Explorer
              </button>
              <button onClick={handleDelete}>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
```

#### Add Profile Form (`webview/src/components/AddProfileForm.tsx`)

```typescript
import React, { useState } from 'react';

interface AddProfileFormProps {
  onSubmit: (email: string, displayName?: string, theme?: string, color?: string) => void;
  onCancel: () => void;
}

export const AddProfileForm: React.FC<AddProfileFormProps> = ({
  onSubmit,
  onCancel,
}) => {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [theme, setTheme] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      setError('Email is required');
      return;
    }

    if (!email.includes('@')) {
      setError('Invalid email format');
      return;
    }

    onSubmit(
      email,
      displayName || undefined,
      theme || undefined,
      color
    );
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add Profile</h3>
          <button className="btn-close" onClick={onCancel}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email *</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="displayName">Display Name</label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g., Work, Personal"
            />
          </div>

          <div className="form-group">
            <label htmlFor="theme">Theme (optional)</label>
            <input
              id="theme"
              type="text"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="Dark+, Light+"
            />
          </div>

          <div className="form-group">
            <label htmlFor="color">Color</label>
            <input
              id="color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="form-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Create & Launch
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
```

#### Empty State (`webview/src/components/EmptyState.tsx`)

```typescript
import React from 'react';

interface EmptyStateProps {
  onAddProfile: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onAddProfile }) => {
  return (
    <div className="empty-state">
      <div className="icon">👤</div>
      <h3>No profiles yet</h3>
      <p>Create a profile to manage multiple Cursor accounts</p>
      <button className="btn-primary" onClick={onAddProfile}>
        Add Your First Profile
      </button>
    </div>
  );
};
```

#### Styles (`webview/src/App.css`)

```css
:root {
  --bg-primary: var(--vscode-editor-background);
  --bg-secondary: var(--vscode-sideBar-background);
  --fg-primary: var(--vscode-editor-foreground);
  --fg-secondary: var(--vscode-descriptionForeground);
  --border-color: var(--vscode-panel-border);
  --button-bg: var(--vscode-button-background);
  --button-fg: var(--vscode-button-foreground);
  --button-hover: var(--vscode-button-hoverBackground);
  --error-bg: var(--vscode-inputValidation-errorBackground);
  --error-fg: var(--vscode-inputValidation-errorForeground);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--fg-primary);
  background: var(--bg-primary);
  padding: 16px;
}

.app {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header h2 {
  font-size: 18px;
  font-weight: 600;
}

.btn-primary {
  background: var(--button-bg);
  color: var(--button-fg);
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.btn-primary:hover {
  background: var(--button-hover);
}

.current-profile {
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-radius: 4px;
  font-size: 12px;
}

.current-profile .label {
  color: var(--fg-secondary);
  margin-right: 8px;
}

.profile-name {
  font-weight: 600;
}

.error-banner {
  padding: 8px 12px;
  background: var(--error-bg);
  color: var(--error-fg);
  border-radius: 4px;
  font-size: 13px;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 16px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--fg-secondary);
  border-top-color: var(--button-bg);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.profile-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.profile-card {
  border: 1px solid var(--border-color);
  border-left-width: 4px;
  border-radius: 4px;
  padding: 12px;
  background: var(--bg-secondary);
}

.profile-card.current {
  border-left-color: var(--button-bg);
}

.profile-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.profile-info h3 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
}

.profile-info .email {
  font-size: 12px;
  color: var(--fg-secondary);
}

.badge {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--button-bg);
  color: var(--button-fg);
  border-radius: 12px;
}

.profile-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.btn-launch {
  flex: 1;
  padding: 6px 12px;
  background: var(--button-bg);
  color: var(--button-fg);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.btn-launch:hover:not(:disabled) {
  background: var(--button-hover);
}

.btn-launch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.menu-container {
  position: relative;
}

.btn-menu {
  width: 32px;
  height: 32px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
}

.btn-menu:hover {
  background: var(--bg-primary);
}

.menu {
  position: absolute;
  right: 0;
  top: 100%;
  margin-top: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  z-index: 100;
  min-width: 150px;
}

.menu button {
  display: block;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
}

.menu button:hover {
  background: var(--bg-primary);
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
}

.empty-state .icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-state h3 {
  font-size: 16px;
  margin-bottom: 8px;
}

.empty-state p {
  color: var(--fg-secondary);
  margin-bottom: 20px;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  width: 90%;
  max-width: 400px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h3 {
  font-size: 16px;
  font-weight: 600;
}

.btn-close {
  background: transparent;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--fg-secondary);
}

.btn-close:hover {
  color: var(--fg-primary);
}

form {
  padding: 16px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  color: var(--fg-secondary);
}

.form-group input {
  width: 100%;
  padding: 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--fg-primary);
  font-family: inherit;
  font-size: 13px;
}

.form-group input:focus {
  outline: 1px solid var(--button-bg);
}

.form-error {
  padding: 8px;
  background: var(--error-bg);
  color: var(--error-fg);
  border-radius: 4px;
  font-size: 12px;
  margin-bottom: 12px;
}

.form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.form-actions button {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.form-actions button[type="button"] {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--fg-primary);
}

.form-actions button[type="button"]:hover {
  background: var(--bg-primary);
}
```

### 4. Extension Integration

Update `src/extension.ts` to register the webview provider:

```typescript
import { AccountsPanelProvider } from './ui/accountsPanel';

export function activate(context: vscode.ExtensionContext): void {
  // Existing code...

  // Register accounts panel provider
  const accountsPanel = new AccountsPanelProvider(
    context,
    profileManager,
    profileLauncher,
    profileDetector
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AccountsPanelProvider.viewType,
      accountsPanel
    )
  );
}
```

Update `package.json` to add view container:

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "cursorQuota",
          "title": "Cursor Quota",
          "icon": "$(account)"
        }
      ]
    },
    "views": {
      "cursorQuota": [
        {
          "type": "webview",
          "id": "cursorQuota.accountsPanel",
          "name": "Accounts"
        }
      ]
    }
  },
  "scripts": {
    "compile": "tsc -p ./ && cd webview && npm run build",
    "watch": "tsc -watch -p ./ & cd webview && npm run watch"
  }
}
```

## Build and Development

### Build Output Structure

**CRITICAL**: The webview bundle must be included in the VSIX package. The build produces two output directories:

```
cursor-quota/
├── out/                    # Extension TypeScript output
│   ├── extension.js
│   ├── profiles/
│   ├── ui/
│   └── ...
├── webview-dist/          # Webview bundle (MUST be in VSIX)
│   ├── bundle.js
│   └── bundle.css
├── webview/               # Source (excluded from VSIX)
│   ├── src/
│   └── package.json
└── package.json
```

### .vsixignore Configuration

Update `.vsixignore` to include compiled outputs but exclude source files:

```
# Include compiled outputs (CRITICAL)
!out/**
!webview-dist/**

# Exclude sources
src/**
webview/src/**
webview/node_modules/**
webview/package.json
webview/tsconfig.json
webview/esbuild.config.js

# Exclude development files
.vscode/**
.git/**
*.log
```

### Build Order

The build process must execute in this order:

1. **Webview build**: `cd webview && npm run build` → produces `webview-dist/`
2. **Extension compile**: `tsc -p ./` → produces `out/`
3. **Package**: `vsce package` → bundles both into `.vsix`

The `package.json` scripts handle this correctly:

```json
{
  "scripts": {
    "compile": "tsc -p ./ && cd webview && npm run build",
    "watch": "tsc -watch -p ./ & cd webview && npm run watch",
    "package": "npm run compile && vsce package"
  }
}
```

### Initial Setup
```bash
# Install webview dependencies
cd webview
npm install
cd ..

# Build everything
pnpm run compile

# Verify webview-dist was created
ls webview-dist/  # Should show bundle.js and bundle.css
```

### Development Workflow
```bash
# Terminal 1: Watch TypeScript
pnpm run watch

# Terminal 2: Watch webview
cd webview
npm run watch
```

### Testing
- Press F5 to launch Extension Development Host
- Open Accounts sidebar from Activity Bar
- Test all workflows (add, edit, delete, launch)

## Acceptance Criteria

- [ ] Webview panel registered and visible in sidebar
- [ ] React app builds successfully
- [ ] Profile list displays all configured profiles
- [ ] Current profile highlighted with badge
- [ ] Add profile form functional
- [ ] Launch button works and opens new window
- [ ] Delete profile with confirmation
- [ ] Empty state shows when no profiles
- [ ] Responsive design (works in narrow sidebar)
- [ ] VS Code theme colors respected
- [ ] No console errors
- [ ] Smooth message passing (no lag)

## Known Limitations

- Webview reloads lose transient state (use `getState`/`setState` for persistence)
- Complex forms may need validation library
- No built-in toast notifications (uses console.log)
- Menu closes only on outside click (not on action)

## Troubleshooting

### Webview not loading
- Check `webview-dist/bundle.js` exists
- Verify CSP headers in HTML
- Check browser console in webview dev tools

### Styles not applying
- Ensure CSS bundled correctly
- Check VS Code theme variables
- Try reloading window

### Messages not received
- Verify message types match interfaces
- Check `vscodeApi.ready()` called
- Console.log messages for debugging

## Next Phase

Proceed to **Phase 4: Multi-Profile Monitoring**, which adds:
- MultiProfileQuotaService for parallel quota fetching
- Quota display in profile cards
- Warning indicators for profiles near limits
- Background refresh with caching

## References

- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [React Documentation](https://react.dev/)
- [esbuild Documentation](https://esbuild.github.io/)
