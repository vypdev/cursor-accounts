/** Port for the authenticated control plane exposed by a proxy runtime. */
export interface IProxyControlClient {
  getStatus(): Promise<{ running: boolean }>;
  shutdown(): Promise<void>;
}
