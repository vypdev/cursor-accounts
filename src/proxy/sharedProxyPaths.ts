import * as os from 'os';
import * as path from 'path';
import { DEFAULT_CONFIG_DIR } from '@cursor-accounts/types';

/**
 * Proxy state, certs, and logs live here so every Cursor window (default
 * profile and isolated profile user-data dirs) sees the same MITM proxy.
 */
export function getSharedProxyStorageDir(): string {
  return path.join(os.homedir(), DEFAULT_CONFIG_DIR, 'proxy');
}
