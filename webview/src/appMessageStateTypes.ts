import type {
  EfficiencyStatsMap,
  InitData,
  InstanceInfoMap,
  ModelPricingDisplayData,
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
  OpenWorkspacesData,
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

export type { OpenWorkspacesData };
