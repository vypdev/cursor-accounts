import {
  FromWebviewMessage,
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

const vscode = acquireVsCodeApi();

type MessageHandler = (message: ToWebviewMessage) => void;

class VSCodeAPI {
  private handlers: MessageHandler[] = [];

  constructor() {
    window.addEventListener('message', (event) => {
      const message = event.data as ToWebviewMessage;
      if (message && typeof message === 'object' && 'type' in message) {
        this.handlers.forEach((handler) => handler(message));
      }
    });
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  postMessage(message: FromWebviewMessage): void {
    vscode.postMessage(message);
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
    color?: string
  ): void {
    this.postMessage({ type: 'add', email, displayName, theme, color });
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

  saveState(state: Omit<WebviewPersistedState, 'version'>): void {
    vscode.setState({
      version: WEBVIEW_STATE_VERSION,
      ...state,
    });
  }

  getState(): WebviewPersistedState | undefined {
    const state = vscode.getState();
    if (!state || state.version !== WEBVIEW_STATE_VERSION) {
      return undefined;
    }
    return state;
  }
}

export const vscodeApi = new VSCodeAPI();
