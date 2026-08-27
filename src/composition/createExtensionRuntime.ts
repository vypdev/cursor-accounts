import type * as vscode from 'vscode';
import { ActivityLeaderboardService } from '../api/activityLeaderboardService';
import { QuotaClient } from '../api/quotaClient';
import { UserClient } from '../api/userClient';
import { ProfileAuthReader } from '../auth/profileAuthReader';
import { StaticTokenProvider } from '../auth/tokenProvider';
import { ProfileQuotaFetcher } from '../application/services/profileQuotaFetcher';
import { TokenService } from '../auth/tokenRefresh';
import type { IProfileStorage } from '../domain/ports/IProfileStorage';
import { ProfileQuotaCacheStore } from '../storage/profileQuotaCacheStore';
import { validateUserDataPath } from '../utils/pathUtils';
import { ProxyStateFileStore } from '../proxy/proxyStateFileStore';
import { getSharedProxyStorageDir } from '../proxy/sharedProxyPaths';
import {
  ProxyOutputPresenter,
  getProxyOutputConfig,
} from '../ui/presentation/proxyOutputPresenter';
import { TokenDetectorOutputPresenter } from '../ui/presentation/tokenDetectorOutputPresenter';
import { EfficiencyStatsStorage } from '../modelEfficiency/efficiencyStatsStorage';
import { EfficiencyService } from '../modelEfficiency/efficiencyService';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';
import { InstanceDetector } from '../profiles/instanceDetector';
import { ProfileDetector } from '../profiles/profileDetector';
import { ProfileLauncher } from '../profiles/profileLauncher';
import { ProfileSettingsManager } from '../profiles/profileSettingsManager';
import { WorkspaceScanner } from '../profiles/workspaceScanner';
import { MultiProfileQuotaService } from '../services/multiProfileQuotaService';
import { ProfileAccountFetcher } from '../services/profileAccountFetcher';
import { ProfileWorkspaceService } from '../application/services/profileWorkspaceService';
import { ProxyManager } from '../services/proxyManager';
import { ProxySettingsService } from '../services/proxySettingsService';
import { RefreshService } from '../services/refreshService';
import { AccountsPanelProvider } from '../ui/accountsPanel';
import { AgentLiveUsageStatusBar } from '../ui/agentLiveUsageStatusBar';
import { ActiveConversationStatusBar } from '../ui/activeConversationStatusBar';
import { StatusBarManager } from '../ui/statusBarManager';
import { createAccountsPanelStorageBundle } from './createStorageServices';
import { SqliteActiveConversationRepository } from '../cursor/sqliteActiveConversationRepository';
import { WorkspaceStateDbPathResolver } from '../cursor/workspaceStateDbPathResolver';
import { ActiveConversationTracker } from '../services/activeConversationTracker';
import { ActiveConversationTotalsLoader } from '../application/services/activeConversationTotalsLoader';
import { ProxySettingsApplicationService } from '../application/services/proxySettingsApplicationService';
import { ProxySettingsBackupReader } from '../application/services/proxySettingsBackupReader';
import { ProxySettingsRestorationService } from '../application/services/proxySettingsRestorationService';
import { VscodeProxyWindowConfiguration } from '../proxy/vscodeProxyWindowConfiguration';
import * as extensionLog from '../logging/extensionLog';

/** Composition-root overrides used by deterministic integration tests. */
export interface ExtensionActivationDependencies {
  createProfileStorage?: () => IProfileStorage;
  getSharedProxyStorageDir?: () => string;
}

/** Concrete services created once for one extension-host activation. */
export interface ExtensionRuntime {
  profileManager: ProfileManager;
  profileDetector: ProfileDetector;
  instanceDetector: InstanceDetector;
  proxyManager: ProxyManager;
  profileLauncher: ProfileLauncher;
  multiProfileQuotaService: MultiProfileQuotaService;
  efficiencyService: EfficiencyService;
  efficiencyStatsStorage: EfficiencyStatsStorage;
  accountsPanel: AccountsPanelProvider;
  agentLiveUsageStatusBar: AgentLiveUsageStatusBar;
  activeConversationTracker: ActiveConversationTracker;
  activeConversationStatusBar: ActiveConversationStatusBar;
  statusBar: StatusBarManager;
  refreshService: RefreshService;
  proxyOutputPresenter: ProxyOutputPresenter;
  tokenDetectorPresenter: TokenDetectorOutputPresenter;
}

/**
 * Builds the concrete extension services at the composition boundary.
 * Lifecycle starts, command registration, and asynchronous initialization stay
 * in the extension orchestrator so construction remains side-effect focused.
 */
export function createExtensionRuntime(
  context: vscode.ExtensionContext,
  dependencies: ExtensionActivationDependencies = {}
): ExtensionRuntime {
  const profileManager = new ProfileManager(
    dependencies.createProfileStorage?.() ?? new ProfileStorage()
  );
  const profileDetector = new ProfileDetector(profileManager, context);
  const instanceDetector = new InstanceDetector(profileManager);
  const sharedProxyDir =
    dependencies.getSharedProxyStorageDir?.() ?? getSharedProxyStorageDir();
  const proxyStateStore = new ProxyStateFileStore();
  const profileSettingsManager = new ProfileSettingsManager();
  const windowConfiguration = new VscodeProxyWindowConfiguration();
  const proxySettingsApplicationService =
    new ProxySettingsApplicationService({
      profileReader: profileManager,
      profileSettingsManager,
      windowConfiguration,
      instanceDetector,
      warn: extensionLog.warn,
    });
  const proxySettingsRestorationService =
    new ProxySettingsRestorationService({
      profileReader: profileManager,
      profileSettingsManager,
      windowConfiguration,
      error: extensionLog.error,
      debug: extensionLog.debug,
    });
  const proxySettingsBackupReader = new ProxySettingsBackupReader({
    profileReader: profileManager,
    profileSettingsManager,
    debug: extensionLog.debug,
  });
  const proxySettingsService = new ProxySettingsService(
    proxySettingsApplicationService,
    proxySettingsRestorationService,
    proxySettingsBackupReader
  );
  const proxyOutputPresenter = new ProxyOutputPresenter();
  const tokenDetectorPresenter = new TokenDetectorOutputPresenter();
  const proxyManager = new ProxyManager(
    proxyStateStore,
    profileManager,
    context,
    sharedProxyDir,
    proxySettingsService,
    profileSettingsManager,
    proxyOutputPresenter,
    tokenDetectorPresenter,
    undefined,
    getProxyOutputConfig
  );

  const profileLauncher = new ProfileLauncher(
    profileManager,
    instanceDetector,
    proxyManager,
    profileSettingsManager
  );
  const profileWorkspaceService = new ProfileWorkspaceService(
    profileManager,
    new WorkspaceScanner()
  );
  const profileAuthReader = new ProfileAuthReader(context);
  const quotaCache = new ProfileQuotaCacheStore(context.globalState);
  const multiProfileQuotaService = new MultiProfileQuotaService(
    quotaCache,
    profileManager,
    new ProfileQuotaFetcher({
      authReader: profileAuthReader,
      cache: quotaCache,
      createQuotaService: (provider) => new QuotaClient(provider),
      createTokenProvider: (tokens) => new StaticTokenProvider(tokens),
      activityLeaderboardService: new ActivityLeaderboardService(),
      validateProfilePath: validateUserDataPath,
    })
  );
  const profileAccountFetcher = new ProfileAccountFetcher(
    profileAuthReader,
    new UserClient()
  );
  const efficiencyStatsStorage = new EfficiencyStatsStorage(
    context.extensionPath
  );
  const efficiencyService = new EfficiencyService(
    context,
    profileManager,
    profileDetector,
    profileAuthReader,
    efficiencyStatsStorage,
    multiProfileQuotaService
  );
  const storageBundle = createAccountsPanelStorageBundle({
    context,
    profileReader: profileManager,
    profileDetector,
    instanceDetector,
    efficiencyService,
  });
  const accountsPanel = new AccountsPanelProvider(
    context,
    {
      profileManager,
      profileLauncher,
      profileDetector,
      quotaService: multiProfileQuotaService,
      accountFetcher: profileAccountFetcher,
      instanceDetector,
      profileWorkspaceService,
      efficiencyService,
      authReader: profileAuthReader,
      storageCleanupService: storageBundle.storageCleanupService,
      storageAnalyzer: storageBundle.storageAnalyzer,
      proxyManager,
      proxySettingsReader: proxySettingsBackupReader,
      profileSettingsManager,
    }
  );
  const agentLiveUsageStatusBar = new AgentLiveUsageStatusBar(context);
  const workspaceStateDbPathResolver = new WorkspaceStateDbPathResolver(context);
  const activeConversationRepository = new SqliteActiveConversationRepository(
    context.extensionPath
  );
  const activeConversationTracker = new ActiveConversationTracker(
    activeConversationRepository,
    workspaceStateDbPathResolver
  );
  const activeConversationTotalsLoader = new ActiveConversationTotalsLoader({
    profileDetector,
    proxyTraffic: proxyManager,
  });
  const activeConversationStatusBar = new ActiveConversationStatusBar(
    context,
    activeConversationTracker,
    (conversationId, profileId) =>
      activeConversationTotalsLoader.load(conversationId, profileId)
  );
  const statusBar = new StatusBarManager(context, profileDetector);
  const tokenService = new TokenService(context, profileDetector);
  const refreshService = new RefreshService(
    context,
    new QuotaClient(tokenService),
    (usage) => statusBar.render(usage),
    (message) => statusBar.showError(message)
  );

  return {
    profileManager,
    profileDetector,
    instanceDetector,
    proxyManager,
    profileLauncher,
    multiProfileQuotaService,
    efficiencyService,
    efficiencyStatsStorage,
    accountsPanel,
    agentLiveUsageStatusBar,
    activeConversationTracker,
    activeConversationStatusBar,
    statusBar,
    refreshService,
    proxyOutputPresenter,
    tokenDetectorPresenter,
  };
}
