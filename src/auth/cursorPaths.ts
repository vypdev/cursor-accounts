import { createHash } from 'crypto';
import * as os from 'os';
import * as path from 'path';

/** Path to `state.vscdb` for a profile's user data directory. */
export function getProfileStateDbPath(userDataDir: string): string {
  return path.join(userDataDir, 'User', 'globalStorage', 'state.vscdb');
}

/** Global Cursor `state.vscdb` path for the current platform. */
export function getCursorStateDbPath(): string {
  const home = os.homedir();

  switch (process.platform) {
    case 'darwin':
      return path.join(
        home,
        'Library',
        'Application Support',
        'Cursor',
        'User',
        'globalStorage',
        'state.vscdb'
      );
    case 'win32':
      return path.join(
        process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
        'Cursor',
        'User',
        'globalStorage',
        'state.vscdb'
      );
    default:
      return path.join(
        home,
        '.config',
        'Cursor',
        'User',
        'globalStorage',
        'state.vscdb'
      );
  }
}

export const CURSOR_AUTH_KEYS = {
  accessToken: 'cursorAuth/accessToken',
  refreshToken: 'cursorAuth/refreshToken',
  cachedEmail: 'cursorAuth/cachedEmail',
} as const;

export const SECRETS_KEYS = {
  accessToken: 'cursorAccounts.accessToken',
  refreshToken: 'cursorAccounts.refreshToken',
} as const;

/** Stable short hash for scoping secrets to a profile user-data directory. */
export function hashUserDataDir(userDataDir: string): string {
  return createHash('sha256').update(userDataDir).digest('hex').slice(0, 16);
}

/** Profile-scoped secret keys (avoids mixing OAuth tokens across profiles). */
export function getProfileSecretsKeys(userDataDir: string): {
  accessToken: string;
  refreshToken: string;
} {
  const suffix = hashUserDataDir(userDataDir);
  return {
    accessToken: `${SECRETS_KEYS.accessToken}.${suffix}`,
    refreshToken: `${SECRETS_KEYS.refreshToken}.${suffix}`,
  };
}

/** Legacy secret keys from the Cursor Quota extension (pre-rename). */
export const LEGACY_SECRETS_KEYS = {
  accessToken: 'cursorQuota.accessToken',
  refreshToken: 'cursorQuota.refreshToken',
} as const;
