import type {
  EfficiencyStatsMap,
  InitData,
  InstanceInfoMap,
  ModelPricingDisplayData,
  OpenWorkspacesData,
  Profile,
  ProfileAccountMap,
  ProfileAccountView,
  ProfileGithubSummariesMap,
  ProfileGithubTokenStatusMap,
  ProfileQuotaMap,
  ProxyInstallGuide,
  ProxyStatus,
  StorageCleanupResult,
  StorageBreakdown,
  ToWebviewMessage,
} from './types';

export type AppMessageTranslator = (
  key: string,
  args?: Record<string, string | number | undefined>
) => string;

/** State owned by messages received from the extension host. */
export interface AppMessageState {
  profiles: Profile[];
  currentProfile: Profile | null;
  quotas: ProfileQuotaMap;
  profileAccounts: ProfileAccountMap;
  activeAccount: ProfileAccountView | null;
  accountsLoading: boolean;
  runningInstances: InstanceInfoMap;
  profileWorkspaces: Record<string, InitData['profileWorkspaces'][string]>;
  openWorkspacePaths: string[];
  profileGithubSummaries: ProfileGithubSummariesMap;
  profileGithubTokenStatus: ProfileGithubTokenStatusMap;
  efficiencyStats: EfficiencyStatsMap;
  proxyStatus: ProxyStatus | null;
  currentWindowUsesProxy: boolean;
  profileProxyTemporary: Record<string, boolean>;
  installGuide: ProxyInstallGuide | null;
  suggestedEmail: string | undefined;
  suggestedDisplayName: string | undefined;
  suggestedNotice: string | undefined;
  loading: boolean;
  error: string | null;
  success: string | null;
  storageInfo: StorageBreakdown | undefined;
  lastCleanupResult: StorageCleanupResult | undefined;
  showPricesModal: boolean;
  modelPricingData: ModelPricingDisplayData[];
  enabledModelPricingData: ModelPricingDisplayData[];
  pricingLoading: boolean;
}

export type AppMessageAction =
  | {
      type: 'message';
      message: ToWebviewMessage;
      storageProfileId: string | null;
      translate: AppMessageTranslator;
    }
  | { type: 'clearError' }
  | { type: 'clearSuccess' }
  | { type: 'resetStorageMessageState' }
  | { type: 'clearSuggestedProfile' }
  | { type: 'clearInstallGuide' }
  | { type: 'beginModelPricingRequest' }
  | { type: 'closeModelPricing' };

export function createInitialAppMessageState(): AppMessageState {
  return {
    profiles: [],
    currentProfile: null,
    quotas: {},
    profileAccounts: {},
    activeAccount: null,
    accountsLoading: false,
    runningInstances: {},
    profileWorkspaces: {},
    openWorkspacePaths: [],
    profileGithubSummaries: {},
    profileGithubTokenStatus: {},
    efficiencyStats: {},
    proxyStatus: null,
    currentWindowUsesProxy: false,
    profileProxyTemporary: {},
    installGuide: null,
    suggestedEmail: undefined,
    suggestedDisplayName: undefined,
    suggestedNotice: undefined,
    loading: true,
    error: null,
    success: null,
    storageInfo: undefined,
    lastCleanupResult: undefined,
    showPricesModal: false,
    modelPricingData: [],
    enabledModelPricingData: [],
    pricingLoading: false,
  };
}

function applyInitMessage(
  state: AppMessageState,
  data: InitData
): AppMessageState {
  return {
    ...state,
    profiles: data.profiles,
    currentProfile: data.currentProfile,
    quotas: data.quotas ?? {},
    profileAccounts: data.profileAccounts ?? {},
    activeAccount: data.activeAccount ?? null,
    accountsLoading: false,
    runningInstances: data.runningInstances ?? {},
    profileWorkspaces: data.profileWorkspaces ?? {},
    openWorkspacePaths: data.openWorkspacePaths ?? [],
    profileGithubSummaries: data.profileGithubSummaries ?? {},
    profileGithubTokenStatus: data.profileGithubTokenStatus ?? {},
    efficiencyStats: data.efficiencyStats ?? {},
    proxyStatus: data.proxyStatus ?? null,
    currentWindowUsesProxy: data.currentWindowUsesProxy ?? false,
    profileProxyTemporary: data.profileProxyTemporary ?? {},
    loading: false,
  };
}

function applyOpenWorkspacesMessage(
  state: AppMessageState,
  data: OpenWorkspacesData
): AppMessageState {
  return {
    ...state,
    profileWorkspaces: data.profileWorkspaces,
    openWorkspacePaths: data.paths,
  };
}

function applySuggestedProfileMessage(
  state: AppMessageState,
  message: Extract<ToWebviewMessage, { type: 'suggestedProfile' }>
): AppMessageState {
  if (message.notice) {
    return {
      ...state,
      suggestedEmail: undefined,
      suggestedDisplayName: undefined,
      suggestedNotice: message.notice,
    };
  }

  return {
    ...state,
    suggestedEmail: message.email,
    suggestedDisplayName: message.displayName,
    suggestedNotice: undefined,
  };
}

function applyMessage(
  state: AppMessageState,
  message: ToWebviewMessage,
  storageProfileId: string | null,
  translate: AppMessageTranslator
): AppMessageState {
  switch (message.type) {
    case 'init':
      return applyInitMessage(state, message.data);
    case 'proxyStatus':
      return {
        ...state,
        proxyStatus: message.data,
        error:
          message.data?.caCertificateInstalled === true ? null : state.error,
      };
    case 'currentWindowProxyUsage':
      return { ...state, currentWindowUsesProxy: message.usesProxy };
    case 'proxyInstallGuide':
      return { ...state, installGuide: message.data };
    case 'certificateInstallResult':
      return message.success
        ? { ...state, error: null, success: translate('proxy.install.installSuccess') }
        : message.error
          ? {
              ...state,
              success: null,
              error: translate('proxy.install.installFailed', {
                error: message.error,
              }),
            }
          : state;
    case 'certificateUninstallResult':
      return message.success
        ? { ...state, error: null, success: translate('proxy.uninstall.success') }
        : message.error
          ? {
              ...state,
              success: null,
              error: /linux/i.test(message.error)
                ? translate('proxy.uninstall.linuxManual')
                : translate('proxy.uninstall.failed', { error: message.error }),
            }
          : state;
    case 'efficiencyStats':
      return { ...state, efficiencyStats: message.data };
    case 'githubSummaries':
      return {
        ...state,
        profileGithubSummaries: message.data.summaries,
        profileGithubTokenStatus: message.data.tokenStatus,
      };
    case 'openWorkspaces':
      return applyOpenWorkspacesMessage(state, message.data);
    case 'profiles':
      return { ...state, profiles: message.data };
    case 'quotas':
      return { ...state, quotas: message.data };
    case 'profileAccounts':
      return { ...state, profileAccounts: message.data };
    case 'activeAccount':
      return { ...state, activeAccount: message.data };
    case 'accountsLoading':
      return { ...state, accountsLoading: message.data };
    case 'runningInstances':
      return { ...state, runningInstances: message.data };
    case 'currentProfile':
      return { ...state, currentProfile: message.data };
    case 'error':
      return { ...state, loading: false, error: message.message };
    case 'success':
      return { ...state, success: message.message };
    case 'suggestedProfile':
      return applySuggestedProfileMessage(state, message);
    case 'storageInfo':
      return message.data.profileId === storageProfileId
        ? { ...state, storageInfo: message.data }
        : state;
    case 'storageCleanupResult':
      return storageProfileId
        ? message.data.success
          ? {
              ...state,
              lastCleanupResult: message.data,
              error: null,
              success: message.data.message,
            }
          : {
              ...state,
              lastCleanupResult: message.data,
              error: message.data.message,
              success: null,
            }
        : state;
    case 'modelPricing':
      return {
        ...state,
        modelPricingData: message.data,
        enabledModelPricingData: message.enabledModels ?? [],
        pricingLoading: false,
        showPricesModal: true,
      };
    case 'modelPricingError':
      return {
        ...state,
        pricingLoading: false,
        showPricesModal: false,
        error: message.error,
      };
    case 'exportData':
      return state;
  }
}

export function appMessageReducer(
  state: AppMessageState,
  action: AppMessageAction
): AppMessageState {
  switch (action.type) {
    case 'message':
      return applyMessage(
        state,
        action.message,
        action.storageProfileId,
        action.translate
      );
    case 'clearError':
      return { ...state, error: null };
    case 'clearSuccess':
      return { ...state, success: null };
    case 'resetStorageMessageState':
      return { ...state, storageInfo: undefined, lastCleanupResult: undefined };
    case 'clearSuggestedProfile':
      return {
        ...state,
        suggestedEmail: undefined,
        suggestedDisplayName: undefined,
        suggestedNotice: undefined,
      };
    case 'clearInstallGuide':
      return { ...state, installGuide: null };
    case 'beginModelPricingRequest':
      return {
        ...state,
        pricingLoading: true,
        showPricesModal: true,
        modelPricingData: [],
      };
    case 'closeModelPricing':
      return { ...state, pricingLoading: false, showPricesModal: false };
  }
}
