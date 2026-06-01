import type { ProfileSettings } from '../entities/Profile';

export const PROFILE_CONFIG_VERSION = '1.0.0';
export const DEFAULT_CONFIG_DIR = '.cursor-accounts';
export const DEFAULT_CONFIG_FILE = 'config.json';
export const PROFILE_DIR_PREFIX = '.cursor-';
export const PROFILE_EXPORT_VERSION = '1.0.0';
export const WEBVIEW_STATE_VERSION = 1;

export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  autoDetectRunning: true,
  showProfileInStatusBar: true,
  refreshAllInterval: 300,
  confirmBeforeLaunch: false,
};
