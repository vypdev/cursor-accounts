/** Port for synchronizing temporary proxy settings with the active editor window. */
export interface IProxyWindowConfiguration {
  syncProxy(proxyUrl: string): Promise<void>;
  clearProxy(): Promise<void>;
}
