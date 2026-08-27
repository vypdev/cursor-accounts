/** Result of restoring proxy settings across all managed profiles. */
export interface RestoreAllProfilesResult {
  restored: number;
  errors: Array<{ profileId: string; error: string }>;
}

/** Port for restoring profile-owned proxy settings and active-window state. */
export interface IProxySettingsRestorer {
  restoreAllProfiles(): Promise<RestoreAllProfilesResult>;
}
