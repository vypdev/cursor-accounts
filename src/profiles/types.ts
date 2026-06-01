export type {
  CreateProfileOptions,
  ExportedProfile,
  ImportOptions,
  ImportResult,
  ImportValidationResult,
  Profile,
  ProfileConfig,
  ProfileExport,
  ProfileMetadata,
  ProfileSettings,
  QuotaStatus,
  ValidationResult,
} from '../domain';

export type {
  FromWebviewMessage,
  InitData,
  InstanceInfo,
  InstanceInfoMap,
  ProfileAccountMap,
  ProfileQuota,
  ProfileQuotaMap,
  ToWebviewMessage,
  WebviewPersistedState,
} from '@cursor-accounts/types';

export {
  DEFAULT_CONFIG_DIR,
  DEFAULT_CONFIG_FILE,
  DEFAULT_PROFILE_SETTINGS,
  PROFILE_CONFIG_VERSION,
  PROFILE_DIR_PREFIX,
  PROFILE_EXPORT_VERSION,
  WEBVIEW_STATE_VERSION,
  getQuotaStatus,
} from '../domain';

export type { QuotaUsage } from '../domain';
