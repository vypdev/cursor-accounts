import type { IProxyCertificate } from './IProxyCertificate';
import type { IProxyLifecycle } from './IProxyLifecycle';
import type { IProxyOutput } from './IProxyOutput';
import type { IProxyRouting } from './IProxyRouting';
import type { IProxyStatus } from './IProxyStatus';

export type { ProxyStartResult, RestoreAllProfilesResult } from './IProxyLifecycle';
export type {
  ConversationUsagePersistedEvent,
  ConversationUsagePersistedListener,
  IAgentTokenReader,
  IProxyTraffic,
  ProxyTrafficListener,
} from './IProxyTraffic';

/** Port for managing per-profile MITM proxy lifecycle and status. */
export type IProxyManager =
  IProxyLifecycle &
  IProxyStatus &
  IProxyCertificate &
  IProxyOutput &
  IProxyRouting;
