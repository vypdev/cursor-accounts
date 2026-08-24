import type { ProxyStatus } from '@cursor-accounts/types';

/** Read-only proxy status and status-change notifications. */
export interface IProxyStatus {
  getStatus(profileId: string): Promise<ProxyStatus | null>;
  isCurrentWindowUsingProxy(): Promise<boolean>;
  onStatusChange(callback: () => void): void;
}
