import {
  PROXY_API_PATHS,
  type ProxyApiHealthResponse,
} from '../application/types/proxyApi';
import { buildProxyApiBaseUrl } from './api/proxyApiClient';

const DEFAULT_HEALTH_POLL_INTERVAL_MS = 200;

export interface ProxyHealthPollOptions {
  getStderr?: () => string;
  isProcessAlive?: () => boolean;
  pollIntervalMs?: number;
}

export interface ProxyHealthPollResult {
  success: boolean;
  error?: string;
}

/** Poll the child control plane until it reports readiness or startup fails. */
export async function pollProxyHealth(
  apiPort: number,
  timeoutMs: number,
  options: ProxyHealthPollOptions = {},
  apiToken?: string
): Promise<ProxyHealthPollResult> {
  const baseUrl = buildProxyApiBaseUrl(apiPort);
  const deadline = Date.now() + timeoutMs;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_HEALTH_POLL_INTERVAL_MS;

  while (Date.now() < deadline) {
    if (options.isProcessAlive && !options.isProcessAlive()) {
      const stderr = options.getStderr?.().trim();
      return {
        success: false,
        error: stderr
          ? `Proxy process exited before API was ready: ${stderr}`
          : 'Proxy process exited before API was ready',
      };
    }

    try {
      const response = await fetch(`${baseUrl}${PROXY_API_PATHS.health}`, {
        headers: apiToken
          ? { authorization: `Bearer ${apiToken}` }
          : undefined,
      });
      if (response.ok) {
        const body = (await response.json()) as ProxyApiHealthResponse;
        if (body.ok) {
          return { success: true };
        }
      }
    } catch {
      // The API may not be listening yet.
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  const stderr = options.getStderr?.().trim();
  return {
    success: false,
    error: stderr
      ? `Proxy did not become ready within ${timeoutMs}ms: ${stderr}`
      : `Proxy did not become ready within ${timeoutMs}ms`,
  };
}
