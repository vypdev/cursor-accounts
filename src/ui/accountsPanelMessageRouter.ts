import * as extensionLog from '../logging/extensionLog';
import * as lifecycleLog from '../logging/webviewLifecycleLog';
import { t } from '../l10n';
import type { FromWebviewMessage, ToWebviewMessage } from '../profiles/types';

export type AccountsPanelActionMessage = Exclude<
  FromWebviewMessage,
  | { type: 'ready' }
  | { type: 'requestInit' }
  | { type: 'refresh' }
  | { type: 'webviewLog' }
  | { type: 'requestModelPricing' }
>;

export interface AccountsPanelMessageRouterCallbacks {
  setRuntimeReady(): void;
  refresh(): Promise<void>;
  handleAction(message: AccountsPanelActionMessage): Promise<void>;
  requestModelPricing(): Promise<void>;
  postMessage(message: ToWebviewMessage): Promise<void>;
}

export interface AccountsPanelMessageRouterOptions {
  delay?: (milliseconds: number) => Promise<void>;
}

const ACTION_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'launch',
  'add',
  'edit',
  'delete',
  'showInExplorer',
  'export',
  'import',
  'requestSuggestedProfile',
  'toggleEfficiency',
  'requestStorageInfo',
  'cleanStorage',
  'configureGithubToken',
  'clearGithubToken',
  'startProxy',
  'stopProxy',
  'showProxyLogs',
  'showProxyTraffic',
  'getProxyInstallGuide',
  'installProxyCertificate',
  'uninstallProxyCertificate',
  'saveProxyCertificate',
  'refreshProxyStatus',
]);

/** Routes webview messages while keeping panel construction and lifecycle separate. */
export class AccountsPanelMessageRouter {
  private readonly delay: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly callbacks: AccountsPanelMessageRouterCallbacks,
    options: AccountsPanelMessageRouterOptions = {}
  ) {
    this.delay = options.delay ?? defaultDelay;
  }

  async handle(message: FromWebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          lifecycleLog.lifecycle('message.in', { type: 'ready' });
          this.callbacks.setRuntimeReady();
          await this.delay(150);
          await this.callbacks.refresh();
          lifecycleLog.lifecycle('ready.handled');
          break;

        case 'requestInit':
          lifecycleLog.lifecycle('message.in', { type: 'requestInit' });
          await this.callbacks.refresh();
          break;

        case 'refresh':
          lifecycleLog.lifecycle('message.in', { type: 'refresh' });
          await this.callbacks.refresh();
          break;

        case 'webviewLog':
          lifecycleLog.fromWebview(message.level, message.message, message.phase);
          break;

        case 'requestModelPricing':
          await this.callbacks.requestModelPricing();
          break;

        default:
          if (isActionMessage(message)) {
            await this.callbacks.handleAction(message);
          } else {
            const unknown = message as { type?: string };
            extensionLog.warn(
              `[AccountsPanel] Unknown webview message type: ${unknown.type ?? 'undefined'}`
            );
          }
      }
    } catch (error) {
      await this.callbacks.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : t('errors.unknown'),
      });
    }
  }
}

function isActionMessage(
  message: FromWebviewMessage
): message is AccountsPanelActionMessage {
  return ACTION_MESSAGE_TYPES.has(message.type);
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
