import * as os from 'os';
import * as path from 'path';

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
  accessToken: 'cursorQuota.accessToken',
  refreshToken: 'cursorQuota.refreshToken',
} as const;
