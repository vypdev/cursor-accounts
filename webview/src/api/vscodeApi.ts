import type {
  FromWebviewMessage,
  ImportOptions,
  Profile,
  StorageCleanupOptions,
  ToWebviewMessage,
  WebviewPersistedState} from '../types';
import {
  WEBVIEW_STATE_VERSION,
} from '../types';

declare function acquireVsCodeApi(): {
  postMessage(message: FromWebviewMessage): void;
  getState(): WebviewPersistedState | undefined;
  setState(state: WebviewPersistedState): void;
};

function getVsCodeApi() {
  return acquireVsCodeApi();
}

type MessageHandler = (message: ToWebviewMessage) => void;

class VSCodeAPI {
  private handlers: MessageHandler[] = [];
  private pendingMessages: ToWebviewMessage[] = [];
  private vscodeApi?: ReturnType<typeof getVsCodeApi>;

  constructor() {
    window.addEventListener('message', (event) => {
      const message = event.data as ToWebviewMessage;
      if (message && typeof message === 'object' && 'type' in message) {
        this.dispatchMessage(message);
      }
    });
  }

  private get vscode() {
    if (!this.vscodeApi) {
      this.vscodeApi = getVsCodeApi();
    }
    return this.vscodeApi;
  }

  private dispatchMessage(message: ToWebviewMessage): void {
    if (this.handlers.length === 0) {
      this.pendingMessages.push(message);
      return;
    }

    this.handlers.forEach((handler) => handler(message));
  }

  private flushPendingMessages(): void {
    if (this.handlers.length === 0 || this.pendingMessages.length === 0) {
      return;
    }

    const pending = [...this.pendingMessages];
    this.pendingMessages = [];
    for (const message of pending) {
      this.handlers.forEach((handler) => handler(message));
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    this.flushPendingMessages();
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  sendMessage(message: FromWebviewMessage): void {
    this.vscode.postMessage(message);
  }

  requestInit(): void {
    this.sendMessage({ type: 'requestInit' });
  }

  refresh(): void {
    this.sendMessage({ type: 'refresh' });
  }

  launch(profileId: string): void {
    this.sendMessage({ type: 'launch', profileId });
  }

  addProfile(
    email: string,
    displayName?: string,
    theme?: string,
    color?: string,
    emoji?: string
  ): void {
    this.sendMessage({ type: 'add', email, displayName, theme, color, emoji });
  }

  editProfile(profileId: string, updates: Partial<Profile>): void {
    this.sendMessage({ type: 'edit', profileId, updates });
  }

  deleteProfile(profileId: string): void {
    this.sendMessage({ type: 'delete', profileId });
  }

  showInExplorer(profileId: string): void {
    this.sendMessage({ type: 'showInExplorer', profileId });
  }

  exportProfiles(profileIds: string[], includeSettings: boolean): void {
    this.sendMessage({ type: 'export', profileIds, includeSettings });
  }

  importProfiles(data: string, options: ImportOptions): void {
    this.sendMessage({ type: 'import', data, options });
  }

  requestSuggestedProfile(): void {
    this.sendMessage({ type: 'requestSuggestedProfile' });
  }

  toggleEfficiency(profileId: string, enabled: boolean): void {
    this.sendMessage({ type: 'toggleEfficiency', profileId, enabled });
  }

  requestStorageInfo(profileId: string): void {
    this.sendMessage({ type: 'requestStorageInfo', profileId });
  }

  cleanStorage(profileId: string, options: StorageCleanupOptions): void {
    this.sendMessage({ type: 'cleanStorage', profileId, options });
  }

  saveState(state: Omit<WebviewPersistedState, 'version'>): void {
    this.vscode.setState({
      version: WEBVIEW_STATE_VERSION,
      ...state,
    });
  }

  getState(): WebviewPersistedState | undefined {
    const state = this.vscode.getState();
    if (!state || state.version !== WEBVIEW_STATE_VERSION) {
      return undefined;
    }
    return state;
  }
}

export const vscodeApi = new VSCodeAPI();
