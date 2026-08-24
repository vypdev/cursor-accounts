/** Proxy endpoints and port allocation information used by launched profiles. */
export interface IProxyRouting {
  getProxyServerUrl(profileId: string): Promise<string | null>;
  getAllUsedPorts(): Promise<number[]>;
}
