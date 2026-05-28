import {
  FromWebviewMessage,
  ImportOptions,
  Profile,
  ToWebviewMessage,
  WebviewPersistedState,
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
  private vscodeApi?: ReturnType<typeof getVsCodeApi>;

  constructor() {
    window.addEventListener('message', (event) => {
      const message = event.data as ToWebviewMessage;
      if (message && typeof message === 'object' && 'type' in message) {
        this.handlers.forEach((handler) => handler(message));
      }
    });
  }

  private get vscode() {
    if (!this.vscodeApi) {
      this.vscodeApi = getVsCodeApi();
    }
    return this.vscodeApi;
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  postMessage(message: FromWebviewMessage): void {
    this.vscode.postMessage(message);
  }

  ready(): void {
    this.postMessage({ type: 'ready' });
  }

  refresh(): void {
    this.postMessage({ type: 'refresh' });
  }

  launch(profileId: string): void {
    this.postMessage({ type: 'launch', profileId });
  }

  addProfile(
    email: string,
    displayName?: string,
    theme?: string,
    color?: string,
    emoji?: string
  ): void {
    this.postMessage({ type: 'add', email, displayName, theme, color, emoji });
  }

  editProfile(profileId: string, updates: Partial<Profile>): void {
    this.postMessage({ type: 'edit', profileId, updates });
  }

  deleteProfile(profileId: string): void {
    this.postMessage({ type: 'delete', profileId });
  }

  showInExplorer(profileId: string): void {
    this.postMessage({ type: 'showInExplorer', profileId });
  }

  exportProfiles(profileIds: string[], includeSettings: boolean): void {
    this.postMessage({ type: 'export', profileIds, includeSettings });
  }

  importProfiles(data: string, options: ImportOptions): void {
    this.postMessage({ type: 'import', data, options });
  }

  requestSuggestedProfile(): void {
    this.postMessage({ type: 'requestSuggestedProfile' });
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
