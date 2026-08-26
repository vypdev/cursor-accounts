import type { Proxy } from 'http-mitm-proxy';
import type { MitmListenOptions } from './types';

const DEFAULT_CLOSE_TIMEOUT_MS = 2_000;

/** Starts a MITM proxy and normalizes its callback-based listen contract. */
export function listenToMitmProxy(
  proxy: Proxy,
  options: MitmListenOptions
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    proxy.listen(options, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/** Closes a MITM proxy without allowing a broken transport to block shutdown. */
export async function closeMitmProxy(
  proxy: Proxy,
  timeoutMs = DEFAULT_CLOSE_TIMEOUT_MS
): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    try {
      proxy.close(finish);
    } catch {
      finish();
    }
  });
}
