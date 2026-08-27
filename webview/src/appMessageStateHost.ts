import type { ToWebviewMessage } from './types';
import type { AppMessageState } from './appMessageStateTypes';

export type AppHostMessage = Extract<
  ToWebviewMessage,
  {
    type:
      | 'init'
      | 'efficiencyStats'
      | 'githubSummaries'
      | 'openWorkspaces'
      | 'profiles'
      | 'quotas'
      | 'profileAccounts'
      | 'activeAccount'
      | 'accountsLoading'
      | 'runningInstances'
      | 'currentProfile'
      | 'error'
      | 'success'
      | 'suggestedProfile'
      | 'exportData';
  }
>;

export function applyHostMessage(
  state: AppMessageState,
  message: AppHostMessage
): AppMessageState {
  switch (message.type) {
    case 'init':
      return {
        ...state,
        profiles: message.data.profiles,
        currentProfile: message.data.currentProfile,
        quotas: message.data.quotas ?? {},
        profileAccounts: message.data.profileAccounts ?? {},
        activeAccount: message.data.activeAccount ?? null,
        accountsLoading: false,
        runningInstances: message.data.runningInstances ?? {},
        profileWorkspaces: message.data.profileWorkspaces ?? {},
        openWorkspacePaths: message.data.openWorkspacePaths ?? [],
        profileGithubSummaries: message.data.profileGithubSummaries ?? {},
        profileGithubTokenStatus: message.data.profileGithubTokenStatus ?? {},
        efficiencyStats: message.data.efficiencyStats ?? {},
        proxyStatus: message.data.proxyStatus ?? null,
        currentWindowUsesProxy: message.data.currentWindowUsesProxy ?? false,
        profileProxyTemporary: message.data.profileProxyTemporary ?? {},
        loading: false,
      };
    case 'efficiencyStats':
      return { ...state, efficiencyStats: message.data };
    case 'githubSummaries':
      return {
        ...state,
        profileGithubSummaries: message.data.summaries,
        profileGithubTokenStatus: message.data.tokenStatus,
      };
    case 'openWorkspaces':
      return {
        ...state,
        profileWorkspaces: message.data.profileWorkspaces,
        openWorkspacePaths: message.data.paths,
      };
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
    case 'exportData':
      return state;
  }
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
