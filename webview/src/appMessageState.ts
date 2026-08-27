import type { ToWebviewMessage } from './types';
import { applyHostMessage } from './appMessageStateHost';
import { applyPricingMessage } from './appMessageStatePricing';
import { applyProxyMessage } from './appMessageStateProxy';
import { applyStorageMessage } from './appMessageStateStorage';
import type {
  AppMessageAction,
  AppMessageState,
  AppMessageTranslator,
} from './appMessageStateTypes';

export type {
  AppMessageAction,
  AppMessageState,
  AppMessageTranslator,
} from './appMessageStateTypes';

const HOST_MESSAGE_TYPES = [
  'init',
  'efficiencyStats',
  'githubSummaries',
  'openWorkspaces',
  'profiles',
  'quotas',
  'profileAccounts',
  'activeAccount',
  'accountsLoading',
  'runningInstances',
  'currentProfile',
  'error',
  'success',
  'suggestedProfile',
  'exportData',
] as const;

const PROXY_MESSAGE_TYPES = [
  'proxyStatus',
  'currentWindowProxyUsage',
  'proxyInstallGuide',
  'certificateInstallResult',
  'certificateUninstallResult',
] as const;

const STORAGE_MESSAGE_TYPES = ['storageInfo', 'storageCleanupResult'] as const;
const PRICING_MESSAGE_TYPES = ['modelPricing', 'modelPricingError'] as const;

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

function isMessageOfType<K extends ToWebviewMessage['type']>(
  message: ToWebviewMessage,
  types: readonly K[]
): message is Extract<ToWebviewMessage, { type: K }> {
  return types.includes(message.type as K);
}

function applyMessage(
  state: AppMessageState,
  message: ToWebviewMessage,
  storageProfileId: string | null,
  translate: AppMessageTranslator
): AppMessageState {
  if (isMessageOfType(message, HOST_MESSAGE_TYPES)) {
    return applyHostMessage(state, message);
  }
  if (isMessageOfType(message, PROXY_MESSAGE_TYPES)) {
    return applyProxyMessage(state, message, translate);
  }
  if (isMessageOfType(message, STORAGE_MESSAGE_TYPES)) {
    return applyStorageMessage(state, message, storageProfileId);
  }
  if (isMessageOfType(message, PRICING_MESSAGE_TYPES)) {
    return applyPricingMessage(state, message);
  }
  return state;
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
