import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IProfileStorageAnalyzer } from '../domain/ports/IProfileStorageAnalyzer';
import type { IStorageCleanupService } from '../domain/ports/IStorageCleanupService';
import type { InstanceDetector } from '../profiles/instanceDetector';
import type { ProfileLauncher } from '../profiles/profileLauncher';
import type {
  FromWebviewMessage,
  ToWebviewMessage,
} from '../profiles/types';
import type { ProfileWorkspaceService } from '../application/services/profileWorkspaceService';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import type { IProxyCertificate } from '../domain/ports/IProxyCertificate';
import type { IProxyLifecycle } from '../domain/ports/IProxyLifecycle';
import type { IProxyOutput } from '../domain/ports/IProxyOutput';
import { AccountsPanelProxyHandlers } from './accountsPanelProxyHandlers';
import { AccountsPanelStorageHandlers } from './accountsPanelStorageHandlers';
import { AccountsPanelProfileHandlers } from './accountsPanelProfileHandlers';
import { AccountsPanelGithubHandlers } from './accountsPanelGithubHandlers';
import { AccountsPanelLaunchHandlers } from './accountsPanelLaunchHandlers';
import {
  AccountsPanelEfficiencyHandlers,
  type AccountsPanelEfficiencyService,
} from './accountsPanelEfficiencyHandlers';
import { AccountsPanelSuggestedProfileHandlers } from './accountsPanelSuggestedProfileHandlers';

/** Callbacks the panel provides for webview messaging and refresh orchestration. */
export interface AccountsPanelHandlerCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
  refresh(): Promise<void>;
  refreshInstances(): Promise<void>;
  refreshGithubSummaries(): Promise<void>;
  refreshProxyStatus(options?: { checkCertificate?: boolean }): Promise<void>;
  hasActiveWebview(): boolean;
}

/** Dependencies for Accounts panel user-action handlers (webview message use cases). */
export interface AccountsPanelHandlerDeps {
  profileManager: IProfileManager;
  profileLauncher: ProfileLauncher;
  profileDetector: IProfileDetector;
  efficiencyService: AccountsPanelEfficiencyService;
  authReader: IProfileAuthReader;
  instanceDetector: InstanceDetector;
  storageCleanupService: IStorageCleanupService;
  storageAnalyzer: IProfileStorageAnalyzer;
  profileWorkspaceService: ProfileWorkspaceService;
  proxyManager: IProxyLifecycle & IProxyCertificate & IProxyOutput;
  profileSettingsManager?: IProfileSettingsManager;
}

/**
 * Use-case handlers for Accounts panel webview actions.
 * Keeps AccountsPanelProvider focused on webview lifecycle and message routing.
 */
export class AccountsPanelHandlers {
  private readonly launchHandlers: AccountsPanelLaunchHandlers;
  private readonly proxyHandlers: AccountsPanelProxyHandlers;
  private readonly storageHandlers: AccountsPanelStorageHandlers;
  private readonly profileHandlers: AccountsPanelProfileHandlers;
  private readonly githubHandlers: AccountsPanelGithubHandlers;
  private readonly efficiencyHandlers: AccountsPanelEfficiencyHandlers;
  private readonly suggestedProfileHandlers: AccountsPanelSuggestedProfileHandlers;

  constructor(
    deps: AccountsPanelHandlerDeps,
    private readonly callbacks: AccountsPanelHandlerCallbacks
  ) {
    this.proxyHandlers = new AccountsPanelProxyHandlers(
      {
        profileDetector: deps.profileDetector,
        proxyManager: deps.proxyManager,
      },
      {
        postMessage: (message) => callbacks.postMessage(message),
        refreshProxyStatus: (options) => callbacks.refreshProxyStatus(options),
      }
    );
    this.storageHandlers = new AccountsPanelStorageHandlers(
      {
        profileReader: deps.profileManager,
        storageAnalyzer: deps.storageAnalyzer,
        storageCleanupService: deps.storageCleanupService,
      },
      {
        postMessage: (message) => callbacks.postMessage(message),
      }
    );
    this.profileHandlers = new AccountsPanelProfileHandlers(
      {
        profileManager: deps.profileManager,
        profileDetector: deps.profileDetector,
        instanceDetector: deps.instanceDetector,
        proxyManager: deps.proxyManager,
        profileSettingsManager: deps.profileSettingsManager,
      },
      {
        postMessage: (message) => callbacks.postMessage(message),
        refresh: () => callbacks.refresh(),
        refreshProxyStatus: (options) => callbacks.refreshProxyStatus(options),
      }
    );
    this.githubHandlers = new AccountsPanelGithubHandlers(
      { profileWriter: deps.profileManager },
      {
        postMessage: (message) => callbacks.postMessage(message),
        refreshGithubSummaries: () => callbacks.refreshGithubSummaries(),
      }
    );
    this.launchHandlers = new AccountsPanelLaunchHandlers(
      {
        profileManager: deps.profileManager,
        profileLauncher: deps.profileLauncher,
        profileDetector: deps.profileDetector,
        profileWorkspaceService: deps.profileWorkspaceService,
      },
      {
        postMessage: (message) => callbacks.postMessage(message),
        refresh: () => callbacks.refresh(),
        refreshInstances: () => callbacks.refreshInstances(),
      }
    );
    this.efficiencyHandlers = new AccountsPanelEfficiencyHandlers(
      {
        profileDetector: deps.profileDetector,
        efficiencyService: deps.efficiencyService,
      },
      {
        postMessage: (message) => callbacks.postMessage(message),
        refresh: () => callbacks.refresh(),
      }
    );
    this.suggestedProfileHandlers = new AccountsPanelSuggestedProfileHandlers(
      {
        profileDetector: deps.profileDetector,
        authReader: deps.authReader,
        profileManager: deps.profileManager,
      },
      {
        postMessage: (message) => callbacks.postMessage(message),
        hasActiveWebview: () => callbacks.hasActiveWebview(),
      }
    );
  }

  async handle(message: FromWebviewMessage): Promise<void> {
    switch (message.type) {
      case 'launch':
        await this.launchHandlers.launch(message.profileId, message.projectPath);
        break;

      case 'add':
        await this.profileHandlers.add(message);
        break;

      case 'edit':
        await this.profileHandlers.edit(message.profileId, message.updates);
        break;

      case 'delete':
        await this.profileHandlers.delete(message.profileId);
        break;

      case 'showInExplorer':
        await this.profileHandlers.showInExplorer(message.profileId);
        break;

      case 'export':
        await this.profileHandlers.exportProfiles(
          message.profileIds,
          message.includeSettings
        );
        break;

      case 'import':
        await this.profileHandlers.importProfiles(message.data, message.options);
        break;

      case 'requestSuggestedProfile':
        await this.suggestedProfileHandlers.request();
        break;

      case 'toggleEfficiency':
        await this.efficiencyHandlers.toggle(message.profileId, message.enabled);
        break;

      case 'requestStorageInfo':
        await this.storageHandlers.requestInfo(message.profileId);
        break;

      case 'cleanStorage':
        await this.storageHandlers.clean(message.profileId, message.options);
        break;

      case 'configureGithubToken':
        await this.githubHandlers.configure(message.profileId);
        break;

      case 'clearGithubToken':
        await this.githubHandlers.clear(message.profileId);
        break;

      case 'startProxy':
        await this.proxyHandlers.start();
        break;

      case 'stopProxy':
        await this.proxyHandlers.stop();
        break;

      case 'showProxyLogs':
        await this.proxyHandlers.showLogs();
        break;

      case 'showProxyTraffic':
        await this.proxyHandlers.showTraffic();
        break;

      case 'getProxyInstallGuide':
        await this.proxyHandlers.getInstallGuide();
        break;

      case 'installProxyCertificate':
        await this.proxyHandlers.installCertificate();
        break;

      case 'uninstallProxyCertificate':
        await this.proxyHandlers.uninstallCertificate();
        break;

      case 'saveProxyCertificate':
        await this.proxyHandlers.saveCertificate();
        break;

      case 'refreshProxyStatus':
        await this.callbacks.refreshProxyStatus({ checkCertificate: true });
        break;

      default:
        break;
    }
  }

}
