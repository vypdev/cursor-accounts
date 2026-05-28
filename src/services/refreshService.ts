import * as vscode from 'vscode';
import { QuotaUsage } from '../api/types';
import { QuotaClient } from '../api/quotaClient';
import {
  affectsCursorAccountsConfig,
  getCursorAccountsConfig,
} from '../config';

const GLOBAL_CACHE_KEY = 'lastQuota';
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

export class RefreshService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  private backoffMs = 0;
  private consecutiveFailures = 0;
  private abortController: AbortController | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly quotaClient: QuotaClient,
    private readonly onSuccess: (usage: QuotaUsage) => void,
    private readonly onError: (message: string) => void
  ) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (affectsCursorAccountsConfig(event)) {
          this.restart();
        }
      }),
      { dispose: () => this.stop() }
    );
  }

  start(): void {
    this.stop();
    const cfg = getCursorAccountsConfig();
    if (!cfg.refreshEnabled) {
      return;
    }

    void this.tick();
    const intervalMs = cfg.refreshIntervalSeconds * 1000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.abortController?.abort();
    this.abortController = undefined;
  }

  restart(): void {
    this.consecutiveFailures = 0;
    this.backoffMs = 0;
    this.start();
  }

  async tickNow(): Promise<void> {
    this.consecutiveFailures = 0;
    this.backoffMs = 0;
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.inFlight) {
      return;
    }

    if (this.backoffMs > 0) {
      const waitUntil = this.backoffMs;
      await new Promise((resolve) => setTimeout(resolve, waitUntil));
      this.backoffMs = 0;
    }

    this.inFlight = true;
    this.abortController?.abort();
    this.abortController = new AbortController();
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

    try {
      const usage = await this.quotaClient.getUsage(signal);
      await this.context.globalState.update(GLOBAL_CACHE_KEY, usage);
      this.onSuccess(usage);
      this.consecutiveFailures = 0;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch quota usage';
      this.onError(message);
      this.consecutiveFailures += 1;
      this.backoffMs = Math.min(
        MAX_BACKOFF_MS,
        1000 * 2 ** Math.min(this.consecutiveFailures, 8)
      );
    } finally {
      this.inFlight = false;
    }
  }

}
